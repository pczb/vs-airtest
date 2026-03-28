import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
// const sharp = require('sharp') as any;

const EXTENSION_ID = 'vsairtest';
const LEGACY_EXTENSION_ID = 'vs-airtest';
const IMAGE_PREVIEW_VIEW_TYPE = 'vsairtest.imagePreview';
const CAPTURE_SCREENSHOT_COMMAND = 'vsairtest.captureScreenshot';
const CLEAN_CROP_IMAGES_COMMAND = 'vsairtest.cleanCropImages';
const ENABLE_HOVER_PREVIEW_COMMAND = 'vsairtest.enableHoverPreview';
const DISABLE_HOVER_PREVIEW_COMMAND = 'vsairtest.disableHoverPreview';

class ReadonlyImageDocument implements vscode.CustomDocument {
    constructor(public readonly uri: vscode.Uri) { }

    dispose(): void { }
}

type CropSelection = {
    pos: { x: number; y: number; width: number; height: number };
    resolution: { width: number; height: number };
    content: string;
};

type SelectionMode = 'coords' | 'template' | 'point';
type SelectionMessage = {
    command: 'selectedArea';
    mode: SelectionMode;
    pos?: { x: number; y: number; width: number; height: number };
    point?: { x: number; y: number };
    resolution?: { width: number; height: number };
    content?: string;
};

class ImagePreviewEditorProvider implements vscode.CustomReadonlyEditorProvider<ReadonlyImageDocument> {
    private activePanel: vscode.WebviewPanel | undefined;
    private activeDocumentUri: string | undefined;
    private readonly selectionByDocument = new Map<string, CropSelection>();

    constructor(private readonly context: vscode.ExtensionContext) { }

    openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): ReadonlyImageDocument {
        return new ReadonlyImageDocument(uri);
    }

    async resolveCustomEditor(
        document: ReadonlyImageDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        this.activePanel = webviewPanel;
        this.activeDocumentUri = document.uri.toString();
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewPanel.webview.html = await getWebviewContent(this.context, document.uri.fsPath);

        let updateInterval: NodeJS.Timeout | undefined;

        const refreshImage = async () => {
            if (this.activePanel !== webviewPanel) {
                return;
            }
            const imageUrl = await readImageAsDataUrl(document.uri.fsPath);
            await webviewPanel.webview.postMessage({
                command: 'refreshImage',
                imageUrl
            });
        };

        const captureAndRefresh = async () => {
            try {
                await captureScreenshot(document.uri.fsPath, getAdbCommand());
                await refreshImage();
            } catch (error) {
                vscode.window.showErrorMessage(`Error taking screenshot: ${error instanceof Error ? error.message : String(error)}`);
            }
        };

        const messageSubscription = webviewPanel.webview.onDidReceiveMessage(async (message: SelectionMessage | { command: string }) => {
            if (message.command === 'selectedArea') {
                const selectionMessage = message as SelectionMessage;

                if (selectionMessage.mode === 'template' && selectionMessage.pos && selectionMessage.resolution && selectionMessage.content) {
                    this.selectionByDocument.set(document.uri.toString(), {
                        pos: selectionMessage.pos,
                        resolution: selectionMessage.resolution,
                        content: selectionMessage.content
                    });
                    await this.saveSelectionImage();
                    return;
                }

                if (selectionMessage.mode === 'coords' && selectionMessage.pos) {
                    await this.copyRectCoordinates(selectionMessage.pos);
                    return;
                }

                if (selectionMessage.mode === 'point' && selectionMessage.point) {
                    await this.copyPointCoordinates(selectionMessage.point);
                    return;
                }

                return;
            }

            if (message.command === 'copySelection') {
                await this.copySelection();
                return;
            }

            if (message.command === 'saveSelection') {
                await this.saveSelectionImage();
                return;
            }

            if (message.command === 'cleanCropImage') {
                await this.cleanCropImages();
                return;
            }

            if (message.command === 'startUpdate') {
                if (updateInterval) {
                    clearInterval(updateInterval);
                }
                updateInterval = setInterval(() => {
                    void captureAndRefresh();
                }, 1000);
                void captureAndRefresh();
                return;
            }

            if (message.command === 'stopUpdate') {
                if (updateInterval) {
                    clearInterval(updateInterval);
                    updateInterval = undefined;
                }
                return;
            }

            if (message.command === 'updateOnce') {
                if (updateInterval) {
                    clearInterval(updateInterval);
                    updateInterval = undefined;
                }
                await captureAndRefresh();
            }
        }, undefined, this.context.subscriptions);

        webviewPanel.onDidChangeViewState(() => {
            if (webviewPanel.active) {
                this.activePanel = webviewPanel;
                this.activeDocumentUri = document.uri.toString();
            }
        });

        webviewPanel.onDidDispose(() => {
            messageSubscription.dispose();
            if (updateInterval) {
                clearInterval(updateInterval);
            }
            if (this.activePanel === webviewPanel) {
                this.activePanel = undefined;
                this.activeDocumentUri = undefined;
            }
        });
    }

    async copySelection(): Promise<void> {
        const selection = this.getActiveSelection();
        if (!selection) {
            vscode.window.showWarningMessage('No crop selection available yet.');
            return;
        }

        await vscode.env.clipboard.writeText(formatSelectionCoordinates(selection.pos));
        vscode.window.showInformationMessage('Selection coordinates copied.');
    }

    async copyRectCoordinates(pos: { x: number; y: number; width: number; height: number }): Promise<void> {
        await vscode.env.clipboard.writeText(formatSelectionCoordinates(pos));
        vscode.window.showInformationMessage('Selection coordinates copied.');
    }

    async copyPointCoordinates(point: { x: number; y: number }): Promise<void> {
        await vscode.env.clipboard.writeText(formatPointCoordinates(point));
        vscode.window.showInformationMessage('Point coordinates copied.');
    }

    async saveSelectionImage(): Promise<void> {
        const selection = this.getActiveSelection();
        if (!selection) {
            vscode.window.showWarningMessage('No crop selection available yet.');
            return;
        }

        const imageBuffer = Buffer.from(selection.content.split(',')[1], 'base64');
        const timestamp = Date.now();
        const fileName = `tpl${timestamp}.png`;
        const workspaceRoot = await this.getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showWarningMessage('Open a workspace or file before saving crop images.');
            return;
        }

        const templateDir = await this.getTemplateDir();
        const filePath = path.isAbsolute(templateDir)
            ? path.join(templateDir, fileName)
            : path.join(workspaceRoot, templateDir, fileName);
        const relativeTemplatePath = normalizeTemplatePath(path.relative(workspaceRoot, filePath));

        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, imageBuffer);

        const pos = calcPos(selection.pos, selection.resolution);
        const templateString = buildTemplateString(relativeTemplatePath, pos.delta_x, pos.delta_y, selection.resolution);
        await vscode.env.clipboard.writeText(templateString);

        vscode.window.showInformationMessage(`Image saved as ${relativeTemplatePath} and template copied.`);
    }

    async cleanCropImages(): Promise<void> {
        const workspaceRoot = await this.getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showWarningMessage('Open a workspace or file before cleaning crop images.');
            return;
        }

        const templateDir = await this.getTemplateDir();
        const templateRoot = path.isAbsolute(templateDir)
            ? templateDir
            : path.join(workspaceRoot, templateDir);
        const candidates = await findUnusedCropImages(workspaceRoot, templateRoot);
        if (candidates.length === 0) {
            vscode.window.showInformationMessage('No unused crop images found.');
            return;
        }

        for (const filePath of candidates) {
            await fs.promises.unlink(filePath);
        }

        vscode.window.showInformationMessage(`Removed ${candidates.length} unused crop image(s).`);
    }

    private getActiveSelection(): CropSelection | undefined {
        if (!this.activeDocumentUri) {
            return undefined;
        }

        return this.selectionByDocument.get(this.activeDocumentUri);
    }

    private async getWorkspaceRoot(): Promise<string | undefined> {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
            if (workspaceFolder) {
                return workspaceFolder.uri.fsPath;
            }

            return path.dirname(activeEditor.document.uri.fsPath);
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return workspaceFolder.uri.fsPath;
        }

        return undefined;
    }

    private async getTemplateDir(): Promise<string> {
        const activeEditor = vscode.window.activeTextEditor;
        const workspaceFolder = activeEditor ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri) : vscode.workspace.workspaceFolders?.[0];
        const scope = workspaceFolder?.uri;
        return getSettingValue(scope, 'templateDir') ?? 'assets/templates/';
    }
}

export function activate(context: vscode.ExtensionContext) {
    const imageEditorProvider = new ImagePreviewEditorProvider(context);
    let codePreviewEnabled = true;

    const takeScreenshotCommand = vscode.commands.registerCommand(CAPTURE_SCREENSHOT_COMMAND, async () => {
        const screenshotPath = await ensureScreenshotPath(context);
        const adbPath = getAdbCommand(); // 读取用户设置或默认值 adb

        try {
            await captureScreenshot(screenshotPath, adbPath);
            const screenshotUri = vscode.Uri.file(screenshotPath);
            await vscode.commands.executeCommand('vscode.openWith', screenshotUri, IMAGE_PREVIEW_VIEW_TYPE);
        } catch (error) {
            vscode.window.showErrorMessage(`Error taking screenshot: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    const cleanCropImageCommand = vscode.commands.registerCommand(CLEAN_CROP_IMAGES_COMMAND, async () => {
        await imageEditorProvider.cleanCropImages();
    });

    context.subscriptions.push(
        takeScreenshotCommand,
        cleanCropImageCommand,
        vscode.window.registerCustomEditorProvider(
            IMAGE_PREVIEW_VIEW_TYPE,
            imageEditorProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(ENABLE_HOVER_PREVIEW_COMMAND, () => {
            codePreviewEnabled = true;
            vscode.window.showInformationMessage('Code hover preview enabled.');
        }),
        vscode.commands.registerCommand(DISABLE_HOVER_PREVIEW_COMMAND, () => {
            codePreviewEnabled = false;
            vscode.window.showInformationMessage('Code hover preview disabled.');
        })
    );

    context.subscriptions.push(
        vscode.languages.registerHoverProvider({ scheme: 'file' }, {
            provideHover(document, position) {
                if (!codePreviewEnabled) {
                    return undefined;
                }

                const lineText = document.lineAt(position.line).text;
                const fileDir = path.dirname(document.fileName);
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                const workspaceRoot = workspaceFolder?.uri.fsPath ?? fileDir;
                return buildCodeHover(lineText, fileDir, workspaceRoot);
            }
        })
    );
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


function calcPos(pos: { x: number, y: number, width: number, height: number }, resolution: { width: number, height: number }): { delta_x: string, delta_y: string } {
    const { width, height } = resolution;
    const x = pos.x + pos.width / 2;
    const y = pos.y + pos.height / 2;

    const delta_x = ((x - width * 0.5) / width).toFixed(3);
    // Airtest uses the screenshot width as the normalization base for both axes.
    const delta_y = ((y - height * 0.5) / width).toFixed(3);
    return { delta_x: delta_x, delta_y: delta_y };
}

async function getWebviewContent(context: vscode.ExtensionContext, screenshotPath: string): Promise<string> {
    const imageUrl = await readImageAsDataUrl(screenshotPath);
    const extensionPath = context.extensionUri.fsPath;
    // 定义 HTML 文件路径
    const htmlFilePath = path.join(extensionPath, 'webview.html');
    const htmlContent = await fs.promises.readFile(htmlFilePath, 'utf8');
    const finalHtmlContent = htmlContent.replace('${imageUrl}', imageUrl);
    return finalHtmlContent;
}

async function readImageAsDataUrl(filePath: string): Promise<string> {
    const screenshotData = await fs.promises.readFile(filePath);
    const base64Image = Buffer.from(screenshotData).toString('base64');
    return `data:image/png;base64,${base64Image}`;
}

async function ensureScreenshotPath(context: vscode.ExtensionContext): Promise<string> {
    const storagePath = context.globalStorageUri.fsPath;
    await fs.promises.mkdir(storagePath, { recursive: true });
    return path.join(storagePath, 'screenshot.png');
}

async function captureScreenshot(screenshotPath: string, adbPath: string): Promise<void> {
    const screenshotName = path.basename(screenshotPath);
    const remotePath = `/sdcard/${screenshotName}`;
    const { stderr } = await exec(`${adbPath} shell screencap -p "${remotePath}"; ${adbPath} pull "${remotePath}" "${screenshotPath}"`);
    if (stderr) {
        throw new Error(stderr);
    }
}

function getAdbCommand(): string {
    return getSettingValue(undefined, 'adbCommand') ?? 'adb';
}

function getSettingValue(scope: vscode.Uri | undefined, key: 'adbCommand' | 'templateDir'): string | undefined {
    const config = vscode.workspace.getConfiguration(EXTENSION_ID, scope);
    const value = config.get<string>(key);
    if (value) {
        return value;
    }

    const legacyConfig = vscode.workspace.getConfiguration(LEGACY_EXTENSION_ID, scope);
    if (key === 'adbCommand') {
        return legacyConfig.get<string>('adbPath');
    }

    return legacyConfig.get<string>('templateDir');
}

function formatSelectionCoordinates(pos: { x: number; y: number; width: number; height: number }): string {
    return `(${pos.x}, ${pos.y}, ${pos.x + pos.width}, ${pos.y + pos.height})`;
}

function formatPointCoordinates(point: { x: number; y: number }): string {
    return `(${point.x}, ${point.y})`;
}

function normalizeTemplatePath(relativePath: string): string {
    return relativePath.split(path.sep).join('/');
}

function buildTemplateString(filePath: string, deltaX: string, deltaY: string, resolution: { width: number; height: number }): string {
    return `Template(r"${filePath}", record_pos=(${deltaX}, ${deltaY}), resolution=(${resolution.width}, ${resolution.height}))`;
}

function buildCodeHover(lineText: string, fileDir: string, workspaceRoot: string): vscode.Hover | undefined {
    const imageRef = extractTemplateImageRef(lineText);
    if (!imageRef) {
        return undefined;
    }

    const imagePath = resolveImagePath(imageRef, fileDir, workspaceRoot);
    if (!imagePath) {
        const missing = new vscode.MarkdownString(`Template image not found: \`${imageRef}\``);
        return new vscode.Hover(missing);
    }

    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = true;
    markdown.supportHtml = true;
    const imageUri = vscode.Uri.file(imagePath).toString();
    markdown.appendMarkdown(`![${imageRef}](${imageUri})`);
    return new vscode.Hover(markdown);
}

function extractTemplateImageRef(lineText: string): string | undefined {
    const templateMatch = lineText.match(/Template\s*\(\s*r?["']([^"']+\.png)["']/);
    if (templateMatch) {
        return templateMatch[1];
    }

    return undefined;
}

function resolveImagePath(imageRef: string, fileDir: string, workspaceRoot: string): string | undefined {
    const candidates = path.isAbsolute(imageRef)
        ? [imageRef]
        : [
            path.join(workspaceRoot, imageRef),
            path.join(fileDir, imageRef),
            path.resolve(fileDir, imageRef)
        ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

async function findUnusedCropImages(workspaceRoot: string, templateRoot: string): Promise<string[]> {
    const [gitAddedFiles, untrackedFiles] = await Promise.all([
        getGitGeneratedFiles(templateRoot),
        getUntrackedCropFiles(templateRoot)
    ]);

    const candidates = Array.from(new Set([...gitAddedFiles, ...untrackedFiles]))
        .filter((filePath) => filePath.endsWith('.png'))
        .filter((filePath) => path.basename(filePath).startsWith('tpl'));

    const unused: string[] = [];
    for (const filePath of candidates) {
        const fileName = path.basename(filePath);
        const isReferenced = await isFileReferenced(workspaceRoot, fileName);
        if (!isReferenced) {
            unused.push(filePath);
        }
    }

    return unused;
}

async function getGitGeneratedFiles(rootDir: string): Promise<string[]> {
    try {
        const { stdout } = await exec(`git -C "${rootDir}" diff --name-only --diff-filter=A -- "*.png"`);
        return stdout
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => path.join(rootDir, entry));
    } catch {
        return [];
    }
}

async function getUntrackedCropFiles(rootDir: string): Promise<string[]> {
    try {
        const { stdout } = await exec(`git -C "${rootDir}" ls-files --others --exclude-standard -- "*.png"`);
        return stdout
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => path.join(rootDir, entry));
    } catch {
        return [];
    }
}

async function isFileReferenced(rootDir: string, fileName: string): Promise<boolean> {
    try {
        const { stdout } = await exec(`rg -n --hidden --glob '!**/*.png' --glob '!**/node_modules/**' --fixed-strings "${fileName}" "${rootDir}"`);
        return stdout.trim().length > 0;
    } catch {
        return false;
    }
}

async function exec(command: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = require('child_process').exec(command, (error: any, stdout: any, stderr: any) => { // ignore_security_alert_wait_for_fix RCE
            if (error) {
                reject({ error, stdout, stderr });
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

export function deactivate() { }

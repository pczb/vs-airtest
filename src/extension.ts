import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const EXTENSION_ID = 'vsairtest';
const LEGACY_EXTENSION_ID = 'vs-airtest';
const AIRTEST_WORKBENCH_VIEW_TYPE = 'vsairtest.airtestWorkbench';
const CAPTURE_SCREENSHOT_COMMAND = 'vsairtest.captureScreenshot';
const CLEAN_CROP_IMAGES_COMMAND = 'vsairtest.cleanCropImages';
const ENABLE_HOVER_PREVIEW_COMMAND = 'vsairtest.enableHoverPreview';
const DISABLE_HOVER_PREVIEW_COMMAND = 'vsairtest.disableHoverPreview';

type CropSelection = {
    pos: { x: number; y: number; width: number; height: number };
    resolution: { width: number; height: number };
    content: string;
};

type SelectionMode = 'coords' | 'template' | 'point';
type WebviewMessage =
    | {
        command: 'selectedArea';
        mode: SelectionMode;
        pos?: { x: number; y: number; width: number; height: number };
        point?: { x: number; y: number };
        resolution?: { width: number; height: number };
        content?: string;
    }
    | { command: 'saveSelection' }
    | { command: 'cleanCropImage' }
    | { command: 'startUpdate' }
    | { command: 'stopUpdate' }
    | { command: 'updateOnce' }
    | { command: 'tapScreen'; point?: { x: number; y: number } }
    | { command: 'saveAdbConfig'; adbCommand?: string; adbConnectTarget?: string };

class AirtestWorkbenchPanel {
    private panel: vscode.WebviewPanel | undefined;
    private currentSelection: CropSelection | undefined;
    private currentAdbCommand = getAdbCommand();
    private currentAdbConnectTarget = getAdbConnectTarget(this.currentAdbCommand);
    private updateInterval: NodeJS.Timeout | undefined;
    private readonly isMac = process.platform === 'darwin';

    constructor(private readonly context: vscode.ExtensionContext) { }

    async revealAndCapture(): Promise<void> {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                AIRTEST_WORKBENCH_VIEW_TYPE,
                'Airtest Workbench',
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [this.context.extensionUri]
                }
            );

            this.panel.onDidDispose(() => {
                this.stopAutoUpdate();
                this.panel = undefined;
            });

            this.panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
                await this.handleMessage(message);
            });
        } else {
            this.panel.reveal(vscode.ViewColumn.Beside, true);
        }

        await this.captureAndRefresh();
    }

    private async handleMessage(message: WebviewMessage): Promise<void> {
        if (message.command === 'selectedArea') {
            if (message.mode === 'template' && message.pos && message.resolution && message.content) {
                this.currentSelection = {
                    pos: message.pos,
                    resolution: message.resolution,
                    content: message.content
                };
                await saveSelectionImage(this.currentSelection);
                return;
            }

            if (message.mode === 'coords' && message.pos) {
                await copyRectCoordinates(message.pos);
                return;
            }

            if (message.mode === 'point' && message.point) {
                await copyPointCoordinates(message.point);
            }
            return;
        }

        if (message.command === 'saveSelection') {
            await saveSelectionImage(this.currentSelection);
            return;
        }

        if (message.command === 'cleanCropImage') {
            await cleanCropImages();
            return;
        }

        if (message.command === 'startUpdate') {
            this.startAutoUpdate();
            await this.captureAndRefresh();
            return;
        }

        if (message.command === 'stopUpdate') {
            this.stopAutoUpdate();
            return;
        }

        if (message.command === 'updateOnce') {
            this.stopAutoUpdate();
            await this.captureAndRefresh();
            return;
        }

        if (message.command === 'tapScreen' && message.point) {
            await tapScreen(this.currentAdbCommand, this.currentAdbConnectTarget, message.point);
            await this.captureAndRefresh();
            return;
        }

        if (message.command === 'saveAdbConfig') {
            this.currentAdbCommand = message.adbCommand?.trim() || 'adb';
            this.currentAdbConnectTarget = message.adbConnectTarget?.trim() || extractDeviceTargetFromAdbCommand(this.currentAdbCommand);
            await updateSettingValue(undefined, 'adbCommand', this.currentAdbCommand);
            await updateSettingValue(undefined, 'adbConnectTarget', this.currentAdbConnectTarget || undefined);
            await this.captureAndRefresh();
            vscode.window.showInformationMessage('ADB settings updated.');
        }
    }

    private startAutoUpdate(): void {
        this.stopAutoUpdate();
        this.updateInterval = setInterval(() => {
            void this.captureAndRefresh();
        }, 1000);
    }

    private stopAutoUpdate(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = undefined;
        }
    }

    private async captureAndRefresh(): Promise<void> {
        const screenshotPath = await ensureScreenshotPath(this.context);
        try {
            await captureScreenshot(screenshotPath, this.currentAdbCommand, this.currentAdbConnectTarget);
            await this.render();
        } catch (error) {
            vscode.window.showErrorMessage(`Error taking screenshot: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async render(): Promise<void> {
        if (!this.panel) {
            return;
        }

        const screenshotPath = await ensureScreenshotPath(this.context);
        await ensureScreenshotFileExists(screenshotPath);
        this.panel.webview.html = await getWebviewContent(this.context, screenshotPath, {
            adbCommand: this.currentAdbCommand,
            adbConnectTarget: this.currentAdbConnectTarget,
            isMac: this.isMac
        });
    }
}

export function activate(context: vscode.ExtensionContext) {
    const workbenchPanel = new AirtestWorkbenchPanel(context);
    let codePreviewEnabled = true;

    context.subscriptions.push(
        vscode.commands.registerCommand(CAPTURE_SCREENSHOT_COMMAND, async () => {
            await workbenchPanel.revealAndCapture();
        }),
        vscode.commands.registerCommand(CLEAN_CROP_IMAGES_COMMAND, async () => {
            await cleanCropImages();
        }),
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

async function getWebviewContent(
    context: vscode.ExtensionContext,
    screenshotPath: string,
    options?: {
        adbCommand?: string;
        adbConnectTarget?: string;
        isMac?: boolean;
    }
): Promise<string> {
    const imageUrl = await readImageAsDataUrl(screenshotPath);
    const extensionPath = context.extensionUri.fsPath;
    const htmlFilePath = path.join(extensionPath, 'webview.html');
    const htmlContent = await fs.promises.readFile(htmlFilePath, 'utf8');
    const modifierKey = options?.isMac ? 'Cmd' : 'Ctrl';
    return htmlContent
        .replace('__IMAGE_URL__', imageUrl)
        .replaceAll('__MODIFIER_KEY__', modifierKey)
        .replace('__ADB_COMMAND__', escapeHtml(options?.adbCommand ?? getAdbCommand()))
        .replace('__ADB_CONNECT_TARGET__', escapeHtml(options?.adbConnectTarget ?? getAdbConnectTarget(options?.adbCommand) ?? ''));
}

function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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

async function ensureScreenshotFileExists(screenshotPath: string): Promise<void> {
    if (fs.existsSync(screenshotPath)) {
        return;
    }

    const emptyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=',
        'base64'
    );
    await fs.promises.writeFile(screenshotPath, emptyPng);
}

async function captureScreenshot(screenshotPath: string, adbPath: string, adbConnectTarget?: string): Promise<void> {
    const screenshotName = path.basename(screenshotPath);
    const remotePath = `/sdcard/${screenshotName}`;
    try {
        await exec(`${adbPath} shell screencap -p "${remotePath}"; ${adbPath} pull "${remotePath}" "${screenshotPath}"`);
    } catch (error) {
        if (adbConnectTarget) {
            try {
                await exec(`${adbPath} connect ${adbConnectTarget}`);
                await exec(`${adbPath} shell screencap -p "${remotePath}"; ${adbPath} pull "${remotePath}" "${screenshotPath}"`);
                return;
            } catch (retryError) {
                throw normalizeExecError(retryError);
            }
        }

        throw normalizeExecError(error);
    }
}

async function tapScreen(adbPath: string, adbConnectTarget: string | undefined, point: { x: number; y: number }): Promise<void> {
    try {
        await exec(`${adbPath} shell input tap ${point.x} ${point.y}`);
    } catch (error) {
        if (adbConnectTarget) {
            try {
                await exec(`${adbPath} connect ${adbConnectTarget}`);
                await exec(`${adbPath} shell input tap ${point.x} ${point.y}`);
                return;
            } catch (retryError) {
                throw normalizeExecError(retryError);
            }
        }

        throw normalizeExecError(error);
    }
}

function getAdbCommand(): string {
    return getSettingValue(undefined, 'adbCommand') ?? 'adb';
}

function getAdbConnectTarget(adbCommand = getAdbCommand()): string | undefined {
    return getSettingValue(undefined, 'adbConnectTarget') ?? extractDeviceTargetFromAdbCommand(adbCommand);
}

function getSettingValue(scope: vscode.Uri | undefined, key: 'adbCommand' | 'adbConnectTarget' | 'templateDir'): string | undefined {
    const config = vscode.workspace.getConfiguration(EXTENSION_ID, scope);
    const value = config.get<string>(key);
    if (value) {
        return value;
    }

    const legacyConfig = vscode.workspace.getConfiguration(LEGACY_EXTENSION_ID, scope);
    if (key === 'adbCommand') {
        return legacyConfig.get<string>('adbPath');
    }
    if (key === 'adbConnectTarget') {
        return undefined;
    }

    return legacyConfig.get<string>('templateDir');
}

async function updateSettingValue(
    scope: vscode.Uri | undefined,
    key: 'adbCommand' | 'adbConnectTarget',
    value: string | undefined
): Promise<void> {
    const config = vscode.workspace.getConfiguration(EXTENSION_ID, scope);
    await config.update(key, value, vscode.ConfigurationTarget.Global);
}

function extractDeviceTargetFromAdbCommand(adbCommand: string): string | undefined {
    const match = adbCommand.match(/(?:^|\s)-s\s+([^\s]+)/);
    return match?.[1];
}

async function copyRectCoordinates(pos: { x: number; y: number; width: number; height: number }): Promise<void> {
    await vscode.env.clipboard.writeText(formatSelectionCoordinates(pos));
    vscode.window.showInformationMessage('Selection coordinates copied.');
}

async function copyPointCoordinates(point: { x: number; y: number }): Promise<void> {
    await vscode.env.clipboard.writeText(formatPointCoordinates(point));
    vscode.window.showInformationMessage('Point coordinates copied.');
}

async function saveSelectionImage(selection: CropSelection | undefined): Promise<void> {
    if (!selection) {
        vscode.window.showWarningMessage('No crop selection available yet.');
        return;
    }

    const imageBuffer = Buffer.from(selection.content.split(',')[1], 'base64');
    const timestamp = Date.now();
    const fileName = `tpl${timestamp}.png`;
    const workspaceRoot = await getWorkspaceRoot();
    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Open a workspace or file before saving crop images.');
        return;
    }

    const templateDir = await getTemplateDir();
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

async function cleanCropImages(): Promise<void> {
    const workspaceRoot = await getWorkspaceRoot();
    if (!workspaceRoot) {
        vscode.window.showWarningMessage('Open a workspace or file before cleaning crop images.');
        return;
    }

    const templateDir = await getTemplateDir();
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

async function getWorkspaceRoot(): Promise<string | undefined> {
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

async function getTemplateDir(): Promise<string> {
    const activeEditor = vscode.window.activeTextEditor;
    const workspaceFolder = activeEditor ? vscode.workspace.getWorkspaceFolder(activeEditor.document.uri) : vscode.workspace.workspaceFolders?.[0];
    const scope = workspaceFolder?.uri;
    return getSettingValue(scope, 'templateDir') ?? 'assets/templates/';
}

function calcPos(pos: { x: number; y: number; width: number; height: number }, resolution: { width: number; height: number }): { delta_x: string; delta_y: string } {
    const { width, height } = resolution;
    const x = pos.x + pos.width / 2;
    const y = pos.y + pos.height / 2;
    return {
        delta_x: ((x - width * 0.5) / width).toFixed(3),
        delta_y: ((y - height * 0.5) / width).toFixed(3)
    };
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
        return new vscode.Hover(new vscode.MarkdownString(`Template image not found: \`${imageRef}\``));
    }

    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = true;
    markdown.supportHtml = true;
    markdown.appendMarkdown(`![${imageRef}](${vscode.Uri.file(imagePath).toString()})`);
    return new vscode.Hover(markdown);
}

function extractTemplateImageRef(lineText: string): string | undefined {
    const templateMatch = lineText.match(/Template\s*\(\s*r?["']([^"']+\.png)["']/);
    return templateMatch?.[1];
}

function resolveImagePath(imageRef: string, fileDir: string, workspaceRoot: string): string | undefined {
    const candidates = path.isAbsolute(imageRef)
        ? [imageRef]
        : [path.join(workspaceRoot, imageRef), path.join(fileDir, imageRef), path.resolve(fileDir, imageRef)];

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
        require('child_process').exec(command, (error: Error | null, stdout: string, stderr: string) => { // ignore_security_alert_wait_for_fix RCE
            if (error) {
                reject({ error, stdout, stderr });
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

function normalizeExecError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    const stderr = typeof error === 'object' && error && 'stderr' in error ? String((error as { stderr?: string }).stderr ?? '') : '';
    const stdout = typeof error === 'object' && error && 'stdout' in error ? String((error as { stdout?: string }).stdout ?? '') : '';
    return new Error(stderr || stdout || String(error));
}

export function deactivate() { }

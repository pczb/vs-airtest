# VS AirTest

`VS AirTest` is a VS Code extension for Airtest-style Android screenshot workflows.

It is designed for people who capture Android screens, crop out UI fragments, and reuse those fragments in automation scripts or visual test assets.

## What It Does

- Captures a screenshot from a connected Android device with `adb`
- Opens the screenshot in a custom editor for interactive crop selection
- Copies crop coordinates to the clipboard
- Saves cropped images into a workspace template directory
- Generates `Template(...)` snippets for automation scripts
- Removes unused crop images that are no longer referenced in the workspace
- Shows image previews when hovering over `Template("...png")` references

## Screenshot Shortcuts

The screenshot editor is built so you can finish the common flows without command palette actions.

- `Drag`: copy the selected crop coordinates
- `Ctrl` / `Cmd` + `Drag`: save the crop image and copy an Airtest `Template(...)` snippet
- `Click`: copy point coordinates
The toolbar still provides buttons for the same actions if you prefer mouse clicks.

## Screenshots And Demo

![Capture Screenshot](https://raw.githubusercontent.com/pczb/vs-airtest/main/docs/images/image.png)

![Template Preview](https://raw.githubusercontent.com/pczb/vs-airtest/main/docs/images/image-1.png)

## Installation

### From VS Code Marketplace

If you publish this extension, install it from the Extensions view in VS Code by searching for `VS AirTest`.

### From A VSIX File

1. Build the extension package with `npx @vscode/vsce package`.
2. Install the generated `.vsix` file in VS Code.

### From Source

1. Clone the repository.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5` in VS Code to launch the Extension Development Host.

## Requirements

- VS Code 1.95.0 or newer
- Android Debug Bridge (`adb`) available on your `PATH`, or configured manually
- A connected Android device with USB debugging enabled

## Configuration

This extension contributes the following settings:

- `vsairtest.adbCommand`: command used for screenshots. Example: `adb -s 127.0.0.1:16384`
- `vsairtest.templateDir`: output directory for saved crop images. Default: `assets/templates/`

## Usage

1. Run `Capture Screenshot` from the Command Palette.
2. The screenshot opens in the custom preview editor.
3. Use the drag shortcuts above to copy coordinates or save templates.
4. Use the toolbar buttons to refresh, clean unused crops, or trigger the same actions with the mouse.
5. Hover over `Template("...png")` references in code to preview the image.

### Toolbar Actions

- `Start Update`: keep refreshing the screenshot every second
- `Stop Update`: stop live refresh
- `Refresh Once`: take a single new screenshot
- `Copy Coords`: copy the current selection coordinates
- `Save Crop`: save the crop image and copy a `Template(...)` snippet
- `Clean Crops`: remove unreferenced crop images in the template directory

## Commands

- `vsairtest.captureScreenshot`
- `vsairtest.cleanCropImages`
- `vsairtest.enableHoverPreview`
- `vsairtest.disableHoverPreview`

## Output Format

When you save a crop, the extension writes a PNG file into the configured template directory and copies a snippet in this format:

```text
Template(r"assets/templates/tpl1234567890.png", record_pos=(0.000, 0.000), resolution=(1080, 2400))
```

The exact `record_pos` and `resolution` values depend on your selected crop and source screenshot.

## FAQ

### Why does screenshot capture fail?

Usually because `adb` is missing, the device is disconnected, or USB debugging is not enabled. Check `vsairtest.adbCommand` if your command is not on the `PATH`.

### Where are screenshots saved?

The temporary screenshot used by the preview is stored in the extension global storage. Cropped template images are saved under `vsairtest.templateDir`, relative to the active workspace unless the path is absolute.

### Why is hover preview not showing images?

Hover preview only works for lines that contain a `Template("...png")` reference and when `vsairtest.enableHoverPreview` is active.

## Development

- `npm install`
- `npm run compile`
- `npm run compile:install`
- `npm run watch`
- `npm run lint`
- `npx @vscode/vsce package`

`npm run compile:install` builds the extension package and installs it into VS Code when the `code` CLI is available.

## Release Notes

Use `CHANGELOG.md` for versioned release notes if you publish updates.

## License

MIT

# Repository Guidelines

## Project Structure & Module Organization
`src/extension.ts` is the extension entrypoint and currently holds command registration, ADB screenshot handling, clipboard/template insertion, and webview rendering logic. Tests live under `src/test/`, with the default VS Code extension test scaffold in `src/test/extension.test.ts`. Build output goes to `dist/` for the bundled extension and `out/` for compiled test files. Root-level assets and config include `webview.html`, `webpack.config.js`, `tsconfig.json`, and `eslint.config.mjs`.

## Build, Test, and Development Commands
Use `npm install` to restore dependencies. Use `npm run compile` to bundle the extension with webpack for development, and `npm run watch` to rebuild on change. Use `npm run package` to create the production bundle used by `vscode:prepublish`. Use `npx @vscode/vsce package` to generate the distributable `.vsix`. For this repository, after code changes are complete, the default final verification step is to rebuild the `.vsix`; do not run extra test flows unless explicitly requested. Use `npm run lint` to check `src/**/*.ts` with ESLint. Use `npm test` only when a change specifically needs the VS Code extension test harness.

## Coding Style & Naming Conventions
This project uses TypeScript targeting ES2022 and the Node16 module system. Match the existing file style: single quotes, semicolons, and 4-space indentation in `src/extension.ts`; preserve tabs only in files that already use them, such as `tsconfig.json`. Prefer `camelCase` for variables and functions, `PascalCase` for types/classes, and descriptive command IDs like `androidScreenshot.adbSnapshot`. Run `npm run lint` before submitting changes; ESLint warns on missing curly braces, `==`, missing semicolons, and nonstandard import naming.

## Testing Guidelines
Tests use the VS Code extension test runner with Mocha-style `suite()` and `test()` blocks plus Node `assert`. Add new tests in `src/test/*.test.ts` and name them after the behavior under test, for example `screenshot-command.test.ts`. Cover command registration, error paths, and webview-related helpers where practical. Unless requested otherwise, prefer packaging verification via `.vsix` generation over running `npm test`.

## Commit & Pull Request Guidelines
The current history uses Conventional Commit style (`feat: android helper`), so keep using prefixes like `feat:`, `fix:`, and `docs:`. Keep commits focused and small. PRs should include a short description, linked issue if one exists, test notes, and screenshots or GIFs for UI or webview changes.

## Configuration Tips
The extension reads `androidhelper.adbPath` from VS Code settings. Avoid hardcoding machine-specific paths in new changes; prefer workspace settings or extension configuration instead.

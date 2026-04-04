# Change Log

All notable changes to the "VS AirTest" extension will be documented in this file.

Check [Keep a Changelog](https://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.0.3] - 2026-04-04

- Replaced custom editor with dedicated Airtest Workbench webview panel for better reliability
- Added editable ADB command and connect-target fields with auto-save on Enter
- Added device tap action (Cmd/Ctrl+Click) with automatic screen refresh
- Enhanced screenshot capture with automatic `adb connect` retry on failure
- Added keyboard shortcuts: R (refresh once), A (toggle auto-refresh), S (save crop), X (clean crops)
- Improved toolbar layout with config inputs and capture status indicator
- Refactored codebase with better error handling and standalone utility functions
- Added `vsairtest.adbConnectTarget` setting for explicit connect target configuration

## [0.0.2] - 2026-03-28

- Aligned Airtest `record_pos` calculation with the upstream normalization rule

## [0.0.1] - 2026-03-28

- Initial public release
- Android screenshot capture from a connected device with `adb`
- Interactive crop selection and coordinate copying
- Crop image export and template snippet generation
- Unused crop cleanup and hover image previews

# Changelog

All notable changes to the Partytown GTM Tag Assistant project will be documented in this file.


## [0.1.1] - 2025-05-16

- Allow regexp inside `tagAssistant.scriptsToMonitor` and use same checks as `loadScriptsOnMainThread`
- Add `tagAssistant.decodeProxyUrl` to decode proxied URLs to force inside Partytown
- Remove `resolveUrl` & `proxyUrl` from README and examples and add `tagAssistant.decodeProxyUrl` instead
- Remove some logs from `partytown-tagassistant-main.js`
- Re-formatted README.md

## [0.1.0] - 2025-05-15

### Added
- Initial release of Partytown GTM Tag Assistant
- Support for running GTM inside Partytown while using Tag Assistant
- Communication tunnel between main thread and worker 
- Script interception mechanism for bootstrap-created scripts
- Configuration options for proxy URL handling
- Debug logging capabilities

### Fixed
- URL encoding issues with proxied GTM requests
- Timing issues with debug queue hooks
- Script type conversion for scripts that should run in Partytown
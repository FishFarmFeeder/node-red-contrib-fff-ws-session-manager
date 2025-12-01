# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/SemVer).

## [0.1.0] - 2025-12-01

### Added

- Initial release of Node-RED WebSocket Session Manager.
- Support for connect, disconnect, update events.
- Context-based storage with Map for efficiency.
- Basic validation and error handling.
- Logging and metrics in node status.
- Security features: input sanitization, optional encryption, key prefixing.
- Additional events: timeout for cleaning expired sessions, get_sessions for querying active sessions.
- Comprehensive documentation and examples.
- Unit tests with Mocha/Chai.
- Linting with ESLint.
- CI/CD with GitHub Actions.

### Changed

- Migrated from array to Map for session storage.
- Improved concurrency with locks.
- Enhanced UI with tooltips and conditional fields.

### Fixed

- Various bug fixes in validation and error handling.

### Security

- Added session ID sanitization.
- Optional config encryption.

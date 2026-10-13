# Security policy

VRift is a local desktop editor that reads and writes user-selected Hacknet extension folders. Security reports are welcome, especially when an issue could access files outside the selected project, execute untrusted content, expose local data, or compromise a packaged release.

## Supported versions

Security fixes are made for the latest released version and the current `main` branch.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| `main` | Yes, before the next release |
| Older releases | No |

Users should reproduce a suspected issue on the latest release when practical. If an older release is affected but the latest release is not, upgrading is the supported remediation.

## Reporting a vulnerability

Do not open a public issue, discussion, or pull request for a vulnerability that has not been coordinated with the maintainers.

Submit a private report through [GitHub Security Advisories](https://github.com/XeraFang-Solutoins/VRift/security/advisories/new). Include as much of the following as possible:

- the affected VRift version or commit;
- operating system and installation type;
- a clear description of the impact and realistic attack scenario;
- exact reproduction steps or a minimal proof of concept;
- whether user interaction is required;
- affected files, functions, or dependencies;
- logs or screenshots with secrets and personal paths removed; and
- any suggested mitigation or fix.

If private vulnerability reporting is unavailable, open a public issue that only asks the maintainers to enable or provide a private reporting channel. Do not include exploit details in that issue.

## What to expect

Maintainers will review reports on a best-effort basis, confirm whether the issue is in scope, and coordinate validation and disclosure with the reporter. Response and release timing depends on severity, reproducibility, maintainer availability, and platform build requirements; this project does not promise a fixed service-level deadline.

Please allow time for a patched release to reach every supported platform before publishing details. Credit will be offered when desired, unless legal or safety constraints prevent it.

## In-scope examples

- reading, writing, renaming, copying, or deleting files outside the folder the user selected;
- path traversal or unsafe handling of extension-controlled paths;
- execution of XML, HTML, script, image, or schema content that should be treated as data;
- code execution through the Tauri command boundary, WebView, or packaged application;
- exposure of local files or sensitive system information through editor previews, logs, or links;
- unsafe update, release, archive, or dependency behavior that could distribute modified binaries;
- bypasses of the application's unsaved-work or recoverable-deletion safeguards that cause unexpected data loss; and
- vulnerable dependencies with a demonstrated, reachable impact in VRift.

## Usually out of scope

- bugs that only make a malformed extension fail to load or crash without crossing a security boundary;
- XML validation mistakes with no confidentiality, integrity, or availability impact beyond the opened project;
- issues that require the user to intentionally edit and run a malicious Hacknet or Pathfinder extension in the game;
- unsigned-build warnings from Windows or macOS, which are a documented distribution limitation;
- attacks requiring prior control of the user's computer or write access to the VRift installation/repository;
- unsupported older releases when the current release is not affected; and
- automated dependency reports without evidence that the vulnerable behavior is reachable.

A reliability bug may still belong in the public [bug tracker](https://github.com/XeraFang-Solutoins/VRift/issues) even when it is not a security vulnerability. When uncertain, report privately first.

## Safe research guidelines

- Test only on systems and files you own or are authorized to use.
- Use disposable extension copies and remove personal information from samples.
- Do not access, modify, or retain another person's data.
- Do not disrupt public services, distribute malicious extensions, or use social engineering.
- Stop testing and report immediately if you encounter unintended sensitive data.
- Give maintainers a reasonable opportunity to investigate and release a fix before disclosure.

## Security considerations for contributors

Changes touching `src/fs`, `src-tauri`, external URL opening, WebView behavior, extension copying, archive/release automation, or untrusted project parsing deserve explicit security review.

Preserve these boundaries:

- extension content is untrusted data, not instructions or executable application code;
- project-relative paths must remain inside the intended project root;
- native commands should expose the smallest operation and permission set needed;
- deletion should remain recoverable through the operating system trash where supported;
- remote content should not gain access to native commands; and
- logs, errors, test fixtures, and reports must not contain credentials or private extension data.

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [architecture guide](docs/architecture.md) before proposing security-sensitive changes.

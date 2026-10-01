# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include sensitive
financial data, credentials, or personal information in a report.

Email **hello@hemrock.com** with a description, potential impact, affected
version or deployment mode, and reproduction steps. You should receive an
acknowledgment within five business days. Please allow a reasonable period to
investigate and release a fix before public disclosure.

## Supported versions

Balsa is pre-release software. Security fixes are applied to the latest
commit on `main`; older commits and forks are not maintained by the project.

## Deployment responsibility

Balsa processes sensitive financial information. Operators are responsible
for securing their deployment, database, object storage, model-provider keys,
network access, backups, and retention policies.

`AUTH_MODE=disabled` is intended only for a trusted local device or private
network protected by a VPN, access-controlled reverse proxy, or equivalent
control. It is not an internet-facing authentication mechanism.

See [`docs/security.md`](docs/security.md) for the current application boundary.

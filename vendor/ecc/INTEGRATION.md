# ECC vendored source

This directory contains the upstream ECC open-source source tree, vendored into Northstar Part 21 Assurance OS so the application does not depend on a runtime checkout or external ECC installation.

- Upstream repository: https://github.com/affaan-m/ecc
- Vendored revision: 3f14a103a8694e51c1df9a806217a6d0b5f7a6f7
- License: MIT (see LICENSE)
- Application extension points: `/api/ecc/library`, `shared/ecc.ts`, and the Skills workspace.

The application surfaces the vendored agents, skills, commands, and hooks beside the Northstar Part 21 skill pack. Northstar-specific skills are kept outside this directory so client-domain code is separately versioned and removable without modifying upstream ECC files.

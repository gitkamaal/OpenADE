# Zeron theme catalog

Resolved built-in registry from Zeron commit `68ef78bb1e6fa0b84feeb68c382230f8c560f96a` (v0.2.92): 19 families, 30 variants. Exported through `zeron_theme::builtin_registry()` and serde_json, rather than re-parsing seed colors. The checked-in JSON retains every source URL, revision, license and asset hash. All 30 variants in 19 families are included. OpenADE’s Apache-2.0 project license is unchanged; upstream notices are retained. Runtime uses the resolved UI/syntax/terminal roles; theme imports remain outside this built-in catalog.

[Zeron MIT license](licenses/zeron-themes-LICENSE.txt) and [upstream notices](licenses/theme-THIRD_PARTY_NOTICES.md). Palette data is adapted for OpenADE’s React/CodeMirror/xterm surfaces. Native materials are independent of palette selection.

| Family | Variant | Appearance | License | Upstream revision |
|---|---|---|---|---|
| Zeron | [Zeron Light](https://github.com/zeronsh/comet) | light | MIT | d138049 |
| Zeron | [Zeron Dark](https://github.com/zeronsh/comet) | dark | MIT | d138049 |
| VS Code Default | [Light+](https://github.com/microsoft/vscode) | light | MIT | e33d147d4c0fa65ce17cb73ec9d798f064b4bf1f |
| VS Code Default | [Dark+](https://github.com/microsoft/vscode) | dark | MIT | e33d147d4c0fa65ce17cb73ec9d798f064b4bf1f |
| Catppuccin | [Catppuccin Latte](https://github.com/catppuccin/vscode) | light | MIT | befc9e6fc41980f4241408f7049755d47c06ff45 |
| Catppuccin | [Catppuccin Mocha](https://github.com/catppuccin/vscode) | dark | MIT | befc9e6fc41980f4241408f7049755d47c06ff45 |
| Tokyo Night | [Tokyo Night Light](https://github.com/tokyo-night/tokyo-night-vscode-theme) | light | MIT | 7c0f11eaef322f293621ca7befe462214b7ea468 |
| Tokyo Night | [Tokyo Night](https://github.com/tokyo-night/tokyo-night-vscode-theme) | dark | MIT | 7c0f11eaef322f293621ca7befe462214b7ea468 |
| Dracula | [Dracula](https://github.com/dracula/visual-studio-code) | dark | MIT | 1b9ecf4d7e0c8cc2e2e890a7a41ad1db5fff1e6c |
| GitHub | [GitHub Light](https://github.com/primer/github-vscode-theme) | light | MIT | cd78e5e4e7bcf132a6f428ae0f32264bb1b729cf |
| GitHub | [GitHub Dark](https://github.com/primer/github-vscode-theme) | dark | MIT | cd78e5e4e7bcf132a6f428ae0f32264bb1b729cf |
| Ayu | [Ayu Light](https://github.com/ayu-theme/vscode-ayu) | light | MIT | 444ef92911cb75c3933c8003e3a7c79b6b6c914f |
| Ayu | [Ayu Dark](https://github.com/ayu-theme/vscode-ayu) | dark | MIT | 444ef92911cb75c3933c8003e3a7c79b6b6c914f |
| Ayu | [Ayu Mirage](https://github.com/ayu-theme/vscode-ayu) | dark | MIT | 444ef92911cb75c3933c8003e3a7c79b6b6c914f |
| Gruvbox | [Gruvbox Light](https://github.com/jdinhify/vscode-theme-gruvbox) | light | MIT | ca3b8ad203e84a884ca33fb84b5795cf43032709 |
| Gruvbox | [Gruvbox Dark](https://github.com/jdinhify/vscode-theme-gruvbox) | dark | MIT | ca3b8ad203e84a884ca33fb84b5795cf43032709 |
| Rosé Pine | [Rosé Pine Dawn](https://github.com/rose-pine/vscode) | light | MIT | d8f5ebe8e096fa833e997c07eb7685ee1677a4ba |
| Rosé Pine | [Rosé Pine Moon](https://github.com/rose-pine/vscode) | dark | MIT | d8f5ebe8e096fa833e997c07eb7685ee1677a4ba |
| Nord | [Nord](https://github.com/nordtheme/visual-studio-code) | dark | MIT | 8ead09822c02d0d49d0f764104505e5a34d3689f |
| One Dark Pro | [One Dark Pro](https://github.com/Binaryify/OneDark-Pro) | dark | MIT | e6ccf638d5b69aa38cd1005edb0ee7ba7ef6fedc |
| Atom One Dark | [Atom One Dark](https://github.com/akamud/vscode-theme-onedark) | dark | MIT | a8be970644982221f9b61fb1c4b3da74b4beab79 |
| Night Owl | [Night Owl Light](https://github.com/sdras/night-owl-vscode-theme) | light | MIT | cc291eba7976b20d7c66bde6883c27b902196b07 |
| Night Owl | [Night Owl](https://github.com/sdras/night-owl-vscode-theme) | dark | MIT | cc291eba7976b20d7c66bde6883c27b902196b07 |
| Winter is Coming | [Winter is Coming Light](https://github.com/johnpapa/vscode-winteriscoming) | light | MIT | 260547834cb6ac37dd5b8bb5842cc1c8d3164946 |
| Winter is Coming | [Winter is Coming Dark Blue](https://github.com/johnpapa/vscode-winteriscoming) | dark | MIT | 260547834cb6ac37dd5b8bb5842cc1c8d3164946 |
| Palenight | [Palenight](https://github.com/whizkydee/vscode-palenight-theme) | dark | MIT | 6291efaace90855abe3d79025327ca41b9a3138c |
| SynthWave '84 | [SynthWave '84](https://github.com/robb0wen/synthwave-vscode) | dark | MIT | ecfa2fe1279f7233663fa3f98a96e6756000567b |
| Shades of Purple | [Shades of Purple](https://github.com/ahmadawais/shades-of-purple-vscode) | dark | MIT with additional upstream condition; see THIRD_PARTY_NOTICES.md | e8eb49f33e5db05ceba6677367b33ddb27ad821c |
| Cobalt2 | [Cobalt2](https://github.com/wesbos/cobalt2-vscode) | dark | MIT | c4e9574372b85afad1682ed0fdd1ac0411c62512 |
| Andromeda | [Andromeda](https://github.com/EliverLara/Andromeda) | dark | MIT | d1abb48c69493000aa0133a32d594eb25e523d4f |

To regenerate, serialize the pinned registry’s `families` with serde_json. Map `colors.background/shell/card/raised/hover`, foreground/border/status roles, all 12 syntax roles used by the editor, and 16 ANSI entries into CSS variables as in `src/ade/themes.css`. No VS Code extension runs in the app.

# Arni Code — Extension Marketplace

## Overview

Arni Code uses **Open VSX Registry** as its extension marketplace, rather than
the Microsoft Visual Studio Marketplace.

## Why Open VSX?

The Microsoft Visual Studio Marketplace is proprietary and its Terms of Service
restrict usage to official Microsoft products (Visual Studio, Visual Studio Code,
and Azure DevOps). Code-OSS forks and alternative builds cannot legally access
the Microsoft Marketplace.

**Open VSX** (https://open-vsx.org) is an open-source, vendor-neutral extension
registry that is compatible with the VS Code extension API.

## Available Extensions

Open VSX hosts **5,000+** extensions, including many popular ones:

- ✅ Language support (Python, Java, Go, Rust, C++, etc.)
- ✅ Git integration extensions
- ✅ Docker and Kubernetes tools
- ✅ Linters and formatters (ESLint, Prettier, etc.)
- ✅ Themes and icon packs
- ✅ Vim, Sublime Text keybindings

## Extensions NOT Available on Open VSX

Some extensions are exclusive to Microsoft's marketplace:

- ❌ GitHub Copilot (proprietary, replaced by built-in Arni agent)
- ❌ Microsoft C# Dev Kit (proprietary; open-source C# support available)
- ❌ Remote Development extensions (SSH, Containers, WSL — proprietary)
- ❌ Some Microsoft-specific extensions

## Installing Extensions

### From Open VSX (built-in)
Use the Extensions panel (`Ctrl+Shift+X`) to browse and install from Open VSX.

### From .vsix files
1. Download the `.vsix` file
2. Open Command Palette (`Ctrl+Shift+P`)
3. Run "Extensions: Install from VSIX..."
4. Select the `.vsix` file

### Future: Custom Gallery
Arni Code may support a custom extension gallery endpoint in the future.
This will be configurable in `product.json` under `extensionsGallery`.

## Configuration

The marketplace is configured in `product.json`:

```json
{
  "extensionsGallery": {
    "serviceUrl": "https://open-vsx.org/vscode/gallery",
    "itemUrl": "https://open-vsx.org/vscode/item"
  }
}
```

To use a different registry, update these URLs accordingly.

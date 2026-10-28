# SoMark MCP Server

[English](README.md) | [中文](README_CN.md)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for **SoMark's document parsing API**. It parses PDF and image files into Markdown, JSON format with high accuracy.

## Quick Start

**1. Get your API Key**
   - Mainland China (中国大陆): [somark.cn/workbench/apikey](https://somark.cn/workbench/apikey)
   - Outside mainland China (including Taiwan, China; Hong Kong, China; Macau, China): [somark.ai/workbench/apikey](https://somark.ai/workbench/apikey)
   - Purchase an API plan:
     - Mainland China: [somark.cn/workbench/purchase](https://somark.cn/workbench/purchase)
     - Global: [somark.ai/studio/purchase](https://somark.ai/studio/purchase)

**2. Add the following to your MCP client configuration** (Claude Desktop, VS Code, Cursor, etc.):

```json
{
    "mcpServers": {
        "somark": {
            "command": "npx",
            "args": ["-y", "somark-mcp"],
            "env": {
                "SOMARK_API_KEY": "your-api-key-here",
                "SOMARK_API_BASE_URL": "https://somark.cn/api/v1"
            }
        }
    }
}
```

**3. Done!** Ask your AI assistant to parse any PDF or image file.

## API Base URL Configuration

Set the `SOMARK_API_BASE_URL` environment variable to choose the server region:

| Region                                                            | `SOMARK_API_BASE_URL`                |
| ----------------------------------------------------------------- | ------------------------------------ |
| Mainland China (default)                                          | `https://somark.cn/api/v1`           |
| Outside mainland China (including Taiwan, China; Hong Kong, China; Macau, China) | `https://somark.ai/api/v1`           |

The server automatically derives the web, docs, and purchase URLs from `SOMARK_API_BASE_URL`:

| Domain        | API Base               | Web                      | Docs                         | Purchase                                    |
| ------------- | ---------------------- | ------------------------ | ---------------------------- | ------------------------------------------- |
| `somark.cn`   | `https://somark.cn/api/v1` | `https://somark.cn`  | `https://docs.somark.cn`  | [somark.cn/workbench/purchase](https://somark.cn/workbench/purchase) |
| `somark.ai`   | `https://somark.ai/api/v1` | `https://somark.ai`  | `https://docs.somark.ai`  | [somark.ai/studio/purchase](https://somark.ai/studio/purchase) |

## Online and private deployments

Both deployments use the same API contract. Set the environment variables for each MCP process:

| Variable | Purpose | Default |
| --- | --- | --- |
| `SOMARK_API_BASE_URL` | API base URL, including the deployment's API prefix | `https://somark.cn/api/v1` |
| `SOMARK_API_KEY` | API key for that deployment | Required for parsing |

For example, a private deployment might use `https://somark.example.internal/api/v1`.
Use the prefix exposed by your deployment; do not append `/parse/sync`.
Trailing slashes are normalized. Invalid or empty explicit addresses fail at startup rather than falling back to the online service.
HTTP and HTTPS are supported; the computer running the MCP process must be able to reach the configured service.
Each process has its own address and key; there is no automatic fallback between deployments.

### Test a local build in Doubao Work or WorkBuddy

Run `pnpm build` first. The published npm package does not include unsubmitted local changes.
Configure the client to run the absolute path to your local `build/index.js`:

```json
{
    "mcpServers": {
        "somark-online": {
            "command": "/absolute/path/to/node",
            "args": ["/absolute/path/to/somark-mcp/build/index.js"],
            "env": {
                "SOMARK_API_BASE_URL": "https://somark.cn/api/v1",
                "SOMARK_API_KEY": "your-online-api-key"
            }
        },
        "somark-private": {
            "command": "/absolute/path/to/node",
            "args": ["/absolute/path/to/somark-mcp/build/index.js"],
            "env": {
                "SOMARK_API_BASE_URL": "https://somark.example.internal/api/v1",
                "SOMARK_API_KEY": "your-private-api-key"
            }
        }
    }
}
```

- **Doubao Work:** Add a custom plugin and choose **STDIO**. Enter the command, argument, and environment variables from the selected entry above. Add a second plugin if you need both deployments.
- **WorkBuddy:** Add the entries through the MCP configuration interface. Give each deployment its own server name.

Enter real keys only in the client's local configuration, not in chat or committed files.
This stdio integration reads the selected local file and uploads it to the configured API.
Parsed content is returned to the AI client; a private parsing endpoint alone does not establish that the entire AI workflow runs privately.

## Available Tools

### `check_api_key`

Check whether the SoMark API key is configured and ready to use.

### `set_api_key`

Set or update the SoMark API key at runtime (useful when the environment variable is not set).

| Parameter | Type   | Required | Description                                                                  |
| --------- | ------ | -------- | ---------------------------------------------------------------------------- |
| `api_key` | string | Yes      | Your SoMark API key from [somark.cn](https://somark.cn/workbench/apikey) (mainland China) or [somark.ai](https://somark.ai/workbench/apikey) (outside mainland China, including Taiwan, China; Hong Kong, China; Macau, China) |

### `extract_document`

Parse PDF or image files (PNG, JPG, JPEG, BMP, TIFF, JP2, DIB, PPM, PGM, PBM, GIF, HEIC, HEIF, WebP, XPM, TGA, DDS, XBM) into `markdown`, `json` format.

| Parameter         | Type                          | Required | Default              | Description                                                                           |
| ----------------- | ----------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------- |
| `file_path`       | string                        | Yes      | —                    | Absolute path to the PDF or image file                                                |
| `output_formats`  | `Array<"json" \| "markdown">` | No       | ["json", "markdown"] | Output formats. Allowed values: `json`, `markdown`. Duplicate values are not allowed. |
| `element_formats` | object                        | No       | See below            | Element rendering formats.                                                            |
| `feature_config`  | object                        | No       | See below            | Extraction options.                                                                   |

**`element_formats` fields:**

- `image`: `"url" | "base64" | "none"`, default `url`
- `formula`: `"latex" | "mathml" | "ascii"`, default `latex`
- `table`: `"html" | "markdown" | "image"`, default `html`
- `cs`: `"image"`, default `image`

**`feature_config` fields:**

- `enable_text_cross_page`: boolean, default `false`
- `enable_table_cross_page`: boolean, default `false`
- `enable_title_level_recognition`: boolean, default `false`
- `enable_inline_image`: boolean, default `true`
- `enable_table_image`: boolean, default `true`
- `enable_image_understanding`: boolean, default `true`
- `keep_header_footer`: boolean, default `false`

**Supported file formats:**

- PDF (`.pdf`)
- PNG (`.png`)
- JPEG (`.jpg`, `.jpeg`)
- BMP (`.bmp`, `.dib`)
- TIFF (`.tiff`, `.tif`)
- JPEG 2000 (`.jp2`)
- Portable Pixmap (`.ppm`)
- Portable Graymap (`.pgm`)
- Portable Bitmap (`.pbm`)
- GIF (`.gif`)
- HEIC (`.heic`)
- HEIF (`.heif`)
- WebP (`.webp`)
- X PixMap (`.xpm`)
- Targa (`.tga`)
- DirectDraw Surface (`.dds`)
- X BitMap (`.xbm`)

**Example usage:**

```json
// Parse a PDF to Markdown
{
  "file_path": "/path/to/document.pdf",
  "output_formats": ["markdown"]
}

// Parse an image to JSON
{
  "file_path": "/path/to/image.png",
  "output_formats": ["json"]
}
```

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build the project
pnpm exec tsc --noEmit  # Type check
```

### Testing

```bash
pnpm test:local       # Build and run loopback-only integration tests with synthetic data
pnpm test             # Full MCP server test
pnpm test:api         # API connection test
```

`test:local` uses no real credentials or model inference and blocks non-loopback HTTP requests.
The other two commands can upload a document to a real API; run them only with an authorized sample, endpoint, and key.

## Troubleshooting

| Problem                  | Solution                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| "API key not configured" | Add `SOMARK_API_KEY` to your MCP client config, or use the `set_api_key` tool                                       |
| Connection issues        | Check that your API key is valid and [somark.cn](https://somark.cn) / [somark.ai](https://somark.ai) (depending on region) is accessible. Set `SOMARK_API_BASE_URL=https://somark.ai/api/v1` for outside mainland China (including Taiwan, China; Hong Kong, China; Macau, China). |
| Unsupported file format  | Supports PDF, PNG, JPG, JPEG, BMP, TIFF, JP2, DIB, PPM, PGM, PBM, GIF, HEIC, HEIF, WebP, XPM, TGA, DDS, XBM formats |

## License

ISC

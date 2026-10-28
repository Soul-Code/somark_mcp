# SoMark MCP Server

[English](README.md) | [中文](README_CN.md)

基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的 **SoMark 文档解析服务器**，支持将 PDF 和图片文件高精度解析为 Markdown、JSON 格式。

## 快速开始

**1. 获取 API Key**
   - 中国大陆：[somark.cn/workbench/apikey](https://somark.cn/workbench/apikey)
   - 中国大陆以外（含中国台湾、中国香港、中国澳门）：[somark.ai/workbench/apikey](https://somark.ai/workbench/apikey)
   - 购买 API 套餐：
     - 中国大陆：[somark.cn/workbench/purchase](https://somark.cn/workbench/purchase)
     - 全球：[somark.ai/studio/purchase](https://somark.ai/studio/purchase)

**2. 将以下配置添加到你的 MCP 客户端**（Claude Desktop、VS Code、Cursor 等）：

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

**3. 完成！** 让你的 AI 助手解析任意 PDF 或图片文件即可。

## API 地址配置

设置 `SOMARK_API_BASE_URL` 环境变量选择服务器区域：

| 地区                                                           | `SOMARK_API_BASE_URL`               |
| -------------------------------------------------------------- | ----------------------------------- |
| 中国大陆（默认）                                               | `https://somark.cn/api/v1`          |
| 中国大陆以外（含中国台湾、中国香港、中国澳门）                 | `https://somark.ai/api/v1`          |

服务器会根据 `SOMARK_API_BASE_URL` 自动推导网站、文档和购买地址：

| 域名          | API 地址                    | 网站                      | 文档                         | 购买                                              |
| ------------- | --------------------------- | ------------------------- | ---------------------------- | ------------------------------------------------- |
| `somark.cn`   | `https://somark.cn/api/v1`  | `https://somark.cn`       | `https://docs.somark.cn`     | [somark.cn/workbench/purchase](https://somark.cn/workbench/purchase) |
| `somark.ai`   | `https://somark.ai/api/v1`  | `https://somark.ai`       | `https://docs.somark.ai`     | [somark.ai/studio/purchase](https://somark.ai/studio/purchase) |

## 线上与私有化部署

两种部署共用同一套 API 协议。为每个 MCP 进程分别配置环境变量：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `SOMARK_API_BASE_URL` | API 基础地址，包含该部署的 API 前缀 | `https://somark.cn/api/v1` |
| `SOMARK_API_KEY` | 对应部署的 API 密钥 | 解析时必需 |

例如，私有化地址可以是 `https://somark.example.internal/api/v1`。
使用该部署实际提供的前缀，不要追加 `/parse/sync`。
末尾斜杠会自动规范化；显式配置的地址为空或不合法时启动失败，不会回退到线上服务。
支持 HTTP 和 HTTPS，运行 MCP 的电脑必须能够访问配置的服务。
每个进程独立使用自己的地址和密钥，不会在不同部署之间自动回退。

### 在豆包工作或 WorkBuddy 中测试本地构建

先运行 `pnpm build`。已发布的 npm 包不包含尚未提交的本地修改。
将客户端配置为运行本地 `build/index.js` 的绝对路径：

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

- **豆包工作**：添加自定义插件，选择 **STDIO**，填写上述对应条目的命令、参数和环境变量。如需同时接入两个部署，分别创建插件。
- **WorkBuddy**：通过 MCP 配置界面添加上述条目，为每个部署使用独立服务名。

真实密钥只填写在客户端本地配置中，不要放入聊天或提交到仓库的文件。
此 STDIO 接入会读取所选本地文件，并上传到配置的 API。
解析内容会返回 AI 客户端；仅将解析服务部署在内网，不代表整条 AI 工作流都在内网运行。

## 可用工具

### `check_api_key`

检查 SoMark API Key 是否已配置并可用。

### `set_api_key`

在运行时设置或更新 SoMark API Key（未设置环境变量时使用）。

| 参数      | 类型   | 必填 | 说明                                                                             |
| --------- | ------ | ---- | -------------------------------------------------------------------------------- |
| `api_key` | string | 是   | 你的 SoMark API Key，从 [somark.cn](https://somark.cn/workbench/apikey)（中国大陆）或 [somark.ai](https://somark.ai/workbench/apikey)（中国大陆以外，含中国台湾、中国香港、中国澳门）获取 |

### `extract_document`

将 PDF 或图片文件（PNG、JPG、JPEG、BMP、TIFF、JP2、DIB、PPM、PGM、PBM、GIF、HEIC、HEIF、WebP、XPM、TGA、DDS、XBM）解析为 `markdown`、`json` 格式。

| 参数              | 类型                          | 必填 | 默认值               | 说明                                                     |
| ----------------- | ----------------------------- | ---- | -------------------- | -------------------------------------------------------- |
| `file_path`       | string                        | 是   | —                    | PDF 或图片文件的绝对路径                                 |
| `output_formats`  | `Array<"json" \| "markdown">` | 否   | ["json", "markdown"] | 输出格式列表。允许值：`json`、`markdown`。不允许重复值。 |
| `element_formats` | object                        | 否   | 见下文               | 元素渲染格式配置。                                       |
| `feature_config`  | object                        | 否   | 见下文               | 提取选项配置。                                           |

**`element_formats` 字段：**

- `image`：`"url" | "base64" | "none"`，默认 `url`
- `formula`：`"latex" | "mathml" | "ascii"`，默认 `latex`
- `table`：`"html" | "markdown" | "image"`，默认 `html`
- `cs`：`"image"`，默认 `image`

**`feature_config` 字段：**

- `enable_text_cross_page`：boolean，默认 `false`
- `enable_table_cross_page`：boolean，默认 `false`
- `enable_title_level_recognition`：boolean，默认 `false`
- `enable_inline_image`：boolean，默认 `true`
- `enable_table_image`：boolean，默认 `true`
- `enable_image_understanding`：boolean，默认 `true`
- `keep_header_footer`：boolean，默认 `false`

**支持的文件格式：**

- PDF (`.pdf`)
- PNG (`.png`)
- JPEG (`.jpg`、`.jpeg`)
- BMP (`.bmp`、`.dib`)
- TIFF (`.tiff`、`.tif`)
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

**使用示例：**

```json
// 将 PDF 解析为 Markdown
{
  "file_path": "/path/to/document.pdf",
  "output_formats": ["markdown"]
}

// 将图片解析为 JSON
{
  "file_path": "/path/to/image.png",
  "output_formats": ["json"]
}
```

## 开发

```bash
pnpm install          # 安装依赖
pnpm build            # 构建项目
pnpm exec tsc --noEmit  # 类型检查
```

### 测试

```bash
pnpm test:local       # 构建并运行仅访问本机的集成测试，使用合成数据
pnpm test             # 完整 MCP 服务器测试
pnpm test:api         # API 连接测试
```

`test:local` 不使用真实凭据、不调用模型，并拦截所有非回环 HTTP 请求。
其余两个命令可能向真实 API 上传文档，只能使用已授权的样本、目标地址和密钥执行。

## 常见问题

| 问题                     | 解决方案                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| "API key not configured" | 在 MCP 客户端配置中添加 `SOMARK_API_KEY`，或使用 `set_api_key` 工具                                          |
| 连接问题                 | 检查 API Key 是否有效，确认 [somark.cn](https://somark.cn) / [somark.ai](https://somark.ai)（根据地区选择）可以访问。中国大陆以外（含中国台湾、中国香港、中国澳门）请设置 `SOMARK_API_BASE_URL=https://somark.ai/api/v1`。 |
| 不支持的文件格式         | 支持 PDF、PNG、JPG、JPEG、BMP、TIFF、JP2、DIB、PPM、PGM、PBM、GIF、HEIC、HEIF、WebP、XPM、TGA、DDS、XBM 格式 |

## 许可证

ISC

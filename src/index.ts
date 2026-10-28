#!/usr/bin/env node
/**
 * SoMark MCP Server
 *
 * This MCP server provides document parsing tools using SoMark API.
 * It supports PDF and image files, converting them to markdown or JSON format.
 * Before using, please obtain an API key from https://somark.cn (mainland China, default)
 * or https://somark.ai (outside mainland China, including Taiwan, China; Hong Kong, China; Macau, China).
 * Set SOMARK_API_BASE_URL to switch between regions (e.g., https://somark.ai/api/v1).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'

// Server configuration
const SERVER_NAME = 'somark_mcp'
const SERVER_VERSION = '1.0.1'

// SoMark API configuration
const MAX_SYNC_FILE_SIZE_BYTES = 200 * 1024 * 1024

/**
 * API base URL from SOMARK_API_BASE_URL env var.
 * - Default (mainland China): https://somark.cn/api/v1
 * - Outside mainland China: https://somark.ai/api/v1
 */
function getApiBaseUrl(): string {
    const raw = (process.env.SOMARK_API_BASE_URL ?? 'https://somark.cn/api/v1').trim()
    const message = 'SOMARK_API_BASE_URL must be an absolute HTTP(S) API base URL without credentials, query parameters, or a fragment.'
    let url: URL
    try {
        url = new URL(raw)
    } catch {
        throw new Error(message)
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
        throw new Error(message)
    }
    return url.toString().replace(/\/+$/, '')
}

/** Extract the domain from the API base URL (e.g., "somark.cn" from "https://somark.cn/api/v1"). */
function getDomain(): string {
    const host = getApiBaseUrl()
    try {
        const url = new URL(host)
        return url.hostname
    } catch {
        return 'somark.cn'
    }
}

/** Web base URL (dashboard, API key page), derived from API base URL. */
function getWebBaseUrl(): string {
    return 'https://' + getDomain()
}

/**
 * Collect image URLs from legacy result.imgs and current outputs.json blocks.
 * The current API response may omit result.imgs entirely.
 */
function collectImageUrls(legacyImages: unknown, jsonOutput: unknown): string[] {
    const imageUrls = new Set<string>()

    const addUrl = (value: unknown) => {
        if (typeof value === 'string' && value.trim()) {
            imageUrls.add(value.trim())
        }
    }

    if (Array.isArray(legacyImages)) {
        legacyImages.forEach(addUrl)
    }

    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(visit)
            return
        }
        if (!value || typeof value !== 'object') {
            return
        }

        const record = value as Record<string, unknown>
        addUrl(record.img_url)
        Object.values(record).forEach(visit)
    }

    visit(jsonOutput)
    return [...imageUrls]
}

const DEFAULT_SOMARK_API_BASE_URL = getApiBaseUrl()

// API Key storage (will be provided via environment variable)
let apiKey: string | null = process.env.SOMARK_API_KEY || null

/**
 * Check if API key is configured
 */
function requireApiKey(): string {
    if (!apiKey) {
        throw new Error(
            "API key not configured. Please use the 'set_api_key' tool to configure your API key, " +
                'or set the SOMARK_API_KEY environment variable. ' +
                'Get your API key from ' + getWebBaseUrl(),
        )
    }
    return apiKey
}

/**
 * Set API key
 */
function setApiKey(key: string): void {
    apiKey = key
    console.error(`API key configured successfully.`)
}

/**
 * Make HTTP request to SoMark API with file upload support
 */
async function somarkRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // Build headers - don't set Content-Type for FormData (fetch handles it automatically)
    // Note: SoMark API uses api_key in request body, not Authorization header
    const headers: HeadersInit =
        options.body instanceof FormData
            ? {} // No special headers for FormData
            : {
                  'Content-Type': 'application/json',
                  ...options.headers,
              }

    try {
        const response = await fetch(`${DEFAULT_SOMARK_API_BASE_URL}${endpoint}`, {
            ...options,
            headers,
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`)
        }

        return response.json() as Promise<T>
    } catch (error) {
        if (error instanceof TypeError && error.message === 'fetch failed') {
            // Network error
            throw new Error(`fetch failed - Cannot reach SoMark API at ${DEFAULT_SOMARK_API_BASE_URL}${endpoint}. Check your network connection.`)
        }
        throw error
    }
}

// Create MCP server instance
const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
        instructions:
            'SoMark MCP Server - Provides document parsing tools for converting PDF and images to markdown or JSON. ' +
            'Each parse consumes the user\'s API quota. Before calling extract_document: if the user has not explicitly specified an output target ' +
            '(file path for saving), ask them where to save the result and in what format (markdown/json), then save it after receiving the result. ' +
            'If the user explicitly asks you to summarize, answer questions, or process content without saving, proceed directly but remind them that quota will be consumed.\n\n' +
            'IMPORTANT: Before using extract_document tool, ALWAYS check if API key is configured by using check_api_key tool first. ' +
            "If API key is not configured, use the 'set_api_key' tool to ask the user for their API key. " +
            'Users can get their API key from ' + getWebBaseUrl(),
    },
)

// ============================================
// Tool Definitions
// ============================================

/**
 * Tool: check_api_key
 * Check if SoMark API key is configured
 */
server.registerTool(
    'check_api_key',
    {
        title: 'Check API Key Status',
        description: 'Check if SoMark API key is configured. Use this before calling extract_document.',
        inputSchema: z.object({}),
    },
    async () => {
        const isConfigured = apiKey !== null && apiKey.length > 0

        return {
            content: [
                {
                    type: 'text',
                    text: isConfigured
                        ? '✓ API key is configured and ready to use.'
                        : "✗ API key is not configured. Please use the 'set_api_key' tool to configure it. Get your API key from " + getWebBaseUrl(),
                },
            ],
        }
    },
)

/**
 * Tool: set_api_key
 * Configure the SoMark API key for authentication
 */
server.registerTool(
    'set_api_key',
    {
        title: 'Set SoMark API Key',
        description: 'Configure your SoMark API key for document parsing. Get your API key from ' + getWebBaseUrl(),
        inputSchema: z.object({
            api_key: z.string().describe('Your SoMark API key from ' + getWebBaseUrl()),
        }),
    },
    async ({ api_key }) => {
        try {
            if (!api_key || api_key.trim().length === 0) {
                throw new Error('API key cannot be empty')
            }

            // Set the API key
            setApiKey(api_key.trim())

            return {
                content: [
                    {
                        type: 'text',
                        text: '✓ API key configured successfully! You can now use the extract_document tool to parse documents.',
                    },
                ],
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error setting API key: ${message}`,
                    },
                ],
                isError: true,
            }
        }
    },
)

/**
 * Tool: extract_document
 * Parse PDF or image files to markdown or JSON format
 */
server.registerTool(
    'extract_document',
    {
        title: 'Extract Document',
        description:
            "Use SoMark's document parsing API to parse PDF or image files (PNG, JPG, JPEG, BMP, TIFF, JP2, DIB, PPM, PGM, PBM, GIF, HEIC, HEIF, WebP, XPM, TGA, DDS, XBM) into Markdown, JSON. " +
            'Parameters: file_path (required), output_formats (optional: json/markdown), element_formats (optional: image/formula/table/cs rendering), feature_config (optional: cross_page/title/header_footer options). ' +
            'REMINDER: Each call consumes API quota. If the user has not specified an output file, ask where to save the result before parsing.',
        inputSchema: z.object({
            file_path: z.string().describe('Absolute path to the PDF or image file to parse'),
            output_formats: z
                .array(z.enum(['json', 'markdown']))
                .refine((values) => new Set(values).size === values.length, 'duplicate values')
                .optional()
                .describe('Output formats. Allowed values: json, markdown'),
            element_formats: z
                .object({
                    image: z.enum(['url', 'base64', 'none']).optional(),
                    formula: z.enum(['latex', 'mathml', 'ascii']).optional(),
                    table: z.enum(['html', 'markdown', 'image']).optional(),
                    cs: z.literal('image').optional(),
                })
                .optional()
                .describe('Element rendering formats. Defaults: image=url, formula=latex, table=html, cs=image'),
            feature_config: z
                .object({
                    enable_text_cross_page: z.boolean().optional(),
                    enable_table_cross_page: z.boolean().optional(),
                    enable_title_level_recognition: z.boolean().optional(),
                    enable_inline_image: z.boolean().optional(),
                    enable_table_image: z.boolean().optional(),
                    enable_image_understanding: z.boolean().optional(),
                    keep_header_footer: z.boolean().optional(),
                })
                .optional()
                .describe('Extraction options'),
        }),
    },
    async ({ file_path, output_formats, element_formats, feature_config }) => {
        try {
            // Check if file exists
            if (!fs.existsSync(file_path)) {
                throw new Error(`File not found: ${file_path}`)
            }

            // Check file extension
            const ext = path.extname(file_path).toLowerCase()
            const allowedExtensions = [
                '.pdf',
                '.png',
                '.jpg',
                '.jpeg',
                '.bmp',
                '.tiff',
                '.tif',
                '.jp2',
                '.dib',
                '.ppm',
                '.pgm',
                '.pbm',
                '.gif',
                '.heic',
                '.heif',
                '.webp',
                '.xpm',
                '.tga',
                '.dds',
                '.xbm',
            ]

            if (!allowedExtensions.includes(ext)) {
                throw new Error(
                    `Unsupported file format: ${ext}. Supported formats: PDF, PNG, JPG, JPEG, BMP, TIFF, JP2, DIB, PPM, PGM, PBM, GIF, HEIC, HEIF, WebP, XPM, TGA, DDS, XBM`,
                )
            }

            const normalizedOutputFormats = output_formats && output_formats.length > 0 ? output_formats : ['json', 'markdown']

            const normalizedElementFormats = {
                image: element_formats?.image ?? 'url',
                formula: element_formats?.formula ?? 'latex',
                table: element_formats?.table ?? 'html',
                cs: element_formats?.cs ?? 'image',
            }

            const normalizedFeatureConfig = {
                enable_text_cross_page: feature_config?.enable_text_cross_page ?? false,
                enable_table_cross_page: feature_config?.enable_table_cross_page ?? false,
                enable_title_level_recognition: feature_config?.enable_title_level_recognition ?? false,
                enable_inline_image: feature_config?.enable_inline_image ?? true,
                enable_table_image: feature_config?.enable_table_image ?? true,
                enable_image_understanding: feature_config?.enable_image_understanding ?? true,
                keep_header_footer: feature_config?.keep_header_footer ?? false,
            }

            const fileName = path.basename(file_path)
            const fileSize = fs.statSync(file_path).size

            if (fileSize > MAX_SYNC_FILE_SIZE_BYTES) {
                throw new Error(
                    `File too large: ${fileName} is ${(fileSize / 1024 / 1024).toFixed(2)} MB. ` +
                        `The current synchronous uploader supports files up to ${(MAX_SYNC_FILE_SIZE_BYTES / 1024 / 1024).toFixed(0)} MB.`,
                )
            }

            // Read file as buffer
            const fileBuffer = fs.readFileSync(file_path)

            console.error(`Processing file: ${fileName} (${(fileSize / 1024).toFixed(2)} KB)`)

            // Determine MIME type based on extension
            const mimeTypes: Record<string, string> = {
                '.pdf': 'application/pdf',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.bmp': 'image/bmp',
                '.tiff': 'image/tiff',
                '.tif': 'image/tiff',
                '.jp2': 'image/jp2',
                '.dib': 'image/bmp',
                '.ppm': 'image/x-portable-pixmap',
                '.pgm': 'image/x-portable-graymap',
                '.pbm': 'image/x-portable-bitmap',
                '.gif': 'image/gif',
                '.heic': 'image/heic',
                '.heif': 'image/heif',
                '.webp': 'image/webp',
                '.xpm': 'image/x-xpixmap',
                '.tga': 'image/x-tga',
                '.dds': 'image/vnd.ms-dds',
                '.xbm': 'image/x-xbitmap',
            }
            const mimeType = mimeTypes[ext] || 'application/octet-stream'

            // Create form data using Node.js native FormData and File
            const formData = new FormData()
            const file = new File([fileBuffer], fileName, { type: mimeType })
            formData.append('file', file)
            formData.append('api_key', requireApiKey())
            for (const item of normalizedOutputFormats) {
                formData.append('output_formats', item)
            }

            formData.append('element_formats', JSON.stringify(normalizedElementFormats))
            formData.append('feature_config', JSON.stringify(normalizedFeatureConfig))

            console.error(`Sending request to SoMark API...`)

            // Make API request
            const response = await somarkRequest<{
                code: number
                message: string
                data: {
                    task_id: string
                    result: {
                        file_name?: string
                        imgs?: unknown
                        outputs?: {
                            markdown?: string
                            json?: unknown
                        }
                    }
                    error: string | null
                    metadata: {
                        page_num?: number
                        file_type?: string
                    }
                }
            }>('/parse/sync', {
                method: 'POST',
                body: formData,
            })

            const { code, message, data } = response

            // Check if API returned an error
            if (code !== 0) {
                throw new Error(`API error: ${data?.error || message || 'Unknown error'}`)
            }

            if (!data?.result) {
                throw new Error('API response is missing data.result')
            }

            const { result } = data
            const outputs = result.outputs ?? {} // 获取解析结果

            const jsonContent = outputs.json
            const markdownContent = typeof outputs.markdown === 'string' && outputs.markdown.trim() ? outputs.markdown : ''
            const hasJsonContent =
                jsonContent !== undefined &&
                jsonContent !== null &&
                (Array.isArray(jsonContent) ? jsonContent.length > 0 : typeof jsonContent !== 'object' || Object.keys(jsonContent).length > 0)
            const imageUrls = normalizedElementFormats.image === 'url' ? collectImageUrls(result.imgs, jsonContent) : []

            const extractedOutputs: Record<string, unknown> = {}
            if (hasJsonContent) {
                extractedOutputs.json = jsonContent
            }
            if (markdownContent) {
                extractedOutputs.markdown = markdownContent
            }

            // Format response based on output format
            let responseText = `Document parsed successfully!\n\n`
            responseText += `- Task ID: ${data.task_id}\n`
            responseText += `- File: ${result.file_name || fileName}\n`

            if (data.metadata.page_num) {
                responseText += `- Pages: ${data.metadata.page_num}\n`
            }
            if (imageUrls.length > 0) {
                responseText += `- Images: ${imageUrls.length}\n`
            }
            if (imageUrls.length > 0) {
                responseText += `- Image URLs:\n${imageUrls.map((u) => `  - ${u}`).join('\n')}\n`
            }

            if (Object.keys(extractedOutputs).length > 0) {
                responseText += `- Outputs: ${Object.keys(extractedOutputs).join(', ')}\n`
            }

            if (markdownContent) {
                responseText += `\n--- Markdown ---\n\n${markdownContent}`
            }

            if (hasJsonContent) {
                responseText += `\n\n--- JSON ---\n\n\`\`\`json\n${JSON.stringify(jsonContent, null, 2)}\n\`\`\``
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: responseText,
                    },
                ],
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error(`Error parsing document: ${message}`)

            // Provide more helpful error messages
            let helpfulMessage = `Error parsing document: ${message}`

            if (message.includes('fetch failed')) {
                helpfulMessage += '\n\nPossible causes:'
                helpfulMessage += '\n- Network connection issue'
                helpfulMessage += '\n- SoMark API server is unreachable'
                helpfulMessage += '\n- Invalid API key'
                helpfulMessage += '\n- Firewall blocking the request'
                helpfulMessage += '\n\nPlease check:'
                helpfulMessage += '\n1. Your internet connection'
                helpfulMessage += '\n2. SOMARK_API_KEY is configured in your MCP client environment'
                helpfulMessage += '\n3. Try accessing ' + getApiBaseUrl() + ' directly'
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: helpfulMessage,
                    },
                ],
                isError: true,
            }
        }
    },
)

// ============================================
// Main Entry Point
// ============================================

async function main() {
    // Validate SOMARK_API_BASE_URL on startup (fail early if invalid)
    try {
        getApiBaseUrl()
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        console.error('❌ ' + message)
        process.exit(1)
    }

    // Check for API key on startup
    if (!apiKey) {
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.error('⚠️  SOMARK_API_KEY environment variable not set.')
        console.error('')
        console.error('To use SoMark MCP Server, you need an API key:')
        console.error('1. Get your API key from: ' + getWebBaseUrl())
        console.error('2. Configure it using one of these methods:')
        console.error("   • Use the 'set_api_key' tool (recommended for this session)")
        console.error("   • Set environment variable: export SOMARK_API_KEY='your-key'")
        console.error('')
        console.error("Don't worry - I'll prompt you for the API key when needed!")
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
        console.error('')
    }

    // Connect using stdio transport
    const transport = new StdioServerTransport()
    await server.connect(transport)

    console.error(`SoMark MCP Server v${SERVER_VERSION} started.`)
    console.error(`SoMark API base: ${DEFAULT_SOMARK_API_BASE_URL}`)
    console.error(`Available tools:`)
    console.error(`  - check_api_key: Check if API key is configured`)
    console.error(`  - set_api_key: Configure your SoMark API key`)
    console.error(`  - extract_document: Parse PDF/images to markdown/JSON`)
}

main().catch((error) => {
    console.error('Failed to start server:', error)
    process.exit(1)
})

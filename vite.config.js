import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { validateBasicSolutionStructure } from './src/utils/saveValidation.js'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const solutionsDirectory = path.join(projectRoot, 'src', 'data', 'solutions')
const solutionIndexPath = path.join(projectRoot, 'src', 'data', 'solution-index.json')
const allowedSolutionIds = new Set(
  JSON.parse(readFileSync(solutionIndexPath, 'utf8'))
    .map((solution) => solution.id)
    .filter((id) => typeof id === 'string')
)
const MAX_SOLUTION_BYTES = 20 * 1024 * 1024

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(value))
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let length = 0
    let tooLarge = false

    request.on('data', (chunk) => {
      if (tooLarge) return
      length += chunk.length
      if (length > MAX_SOLUTION_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      resolve(tooLarge ? null : Buffer.concat(chunks).toString('utf8'))
    })
    request.on('error', reject)
  })
}

function getSolutionId(request) {
  const requestPath = (request.url || '/').split('?')[0]
  const solutionId = requestPath.split('/').filter(Boolean).pop()
  return solutionId && /^[a-z0-9][a-z0-9._-]*$/i.test(solutionId)
    ? solutionId
    : null
}

function getSolutionFilePath(solutionId) {
  if (!allowedSolutionIds.has(solutionId)) return null
  const filePath = path.resolve(solutionsDirectory, `${solutionId}.json`)
  const relativePath = path.relative(solutionsDirectory, filePath)
  return relativePath.startsWith('..') || path.isAbsolute(relativePath)
    ? null
    : filePath
}

function getFileRevision(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function manualSolutionReload() {
  return {
    name: 'manual-solution-reload',
    configureServer(server) {
      server.middlewares.use('/__range-editor/load', (request, response, next) => {
        if (request.method !== 'GET') return next()

        const solutionId = getSolutionId(request)
        const filePath = solutionId && getSolutionFilePath(solutionId)
        if (!filePath) {
          sendJson(response, 400, { error: 'The solution ID is invalid.' })
          return
        }

        void (async () => {
          try {
            const fileInfo = await stat(filePath).catch(() => null)
            if (!fileInfo?.isFile()) {
              sendJson(response, 404, { error: 'The solution file does not exist.' })
              return
            }

            const contents = await readFile(filePath, 'utf8')
            let solution
            try {
              solution = JSON.parse(contents)
            } catch {
              sendJson(response, 400, { error: 'The solution file is not valid JSON.' })
              return
            }
            sendJson(response, 200, {
              solution,
              revision: getFileRevision(contents),
            })
          } catch (error) {
            sendJson(response, 500, {
              error: error instanceof Error ? error.message : 'The solution could not be loaded.',
            })
          }
        })()
      })

      server.middlewares.use('/__range-editor/save', (request, response, next) => {
        if (request.method !== 'POST') return next()

        const origin = request.headers.origin
        if (origin) {
          try {
            if (new URL(origin).host !== request.headers.host) {
              sendJson(response, 403, { error: 'Cross-origin saves are not allowed.' })
              return
            }
          } catch {
            sendJson(response, 403, { error: 'The request origin is invalid.' })
            return
          }
        }

        const solutionId = getSolutionId(request)
        const filePath = solutionId && getSolutionFilePath(solutionId)
        if (!filePath) {
          sendJson(response, 400, { error: 'The solution ID is invalid.' })
          return
        }

        void (async () => {
          try {
            const fileInfo = await stat(filePath).catch(() => null)
            if (!fileInfo?.isFile()) {
              sendJson(response, 404, { error: 'The solution file does not exist.' })
              return
            }

            const body = await readRequestBody(request)
            if (body === null) {
              sendJson(response, 413, { error: 'The solution JSON exceeds the 20 MB limit.' })
              return
            }

            let requestData
            try {
              requestData = JSON.parse(body)
            } catch {
              sendJson(response, 400, { error: 'The submitted solution is not valid JSON.' })
              return
            }

            const { solution, expectedRevision } = requestData || {}
            if (
              typeof expectedRevision !== 'string' ||
              !/^[a-f0-9]{64}$/i.test(expectedRevision)
            ) {
              sendJson(response, 422, {
                error: 'A valid file revision is required.',
              })
              return
            }
            const structureError = validateBasicSolutionStructure(solution)
            if (structureError) {
              sendJson(response, 422, { error: structureError })
              return
            }

            const currentContents = await readFile(filePath, 'utf8')
            const currentRevision = getFileRevision(currentContents)
            if (currentRevision !== expectedRevision) {
              sendJson(response, 409, {
                code: 'FILE_CHANGED',
                error: 'The solution file changed outside the editor.',
                revision: currentRevision,
              })
              return
            }

            const serialized = `${JSON.stringify(solution, null, '\t')}\n`
            const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
            try {
              await writeFile(temporaryPath, serialized, 'utf8')
              await rename(temporaryPath, filePath)
            } catch (error) {
              await unlink(temporaryPath).catch(() => {})
              throw error
            }

            sendJson(response, 200, {
              saved: true,
              revision: getFileRevision(serialized),
            })
          } catch (error) {
            sendJson(response, 500, {
              error: error instanceof Error ? error.message : 'The solution could not be saved.',
            })
          }
        })()
      })
    },
    handleHotUpdate({ file }) {
      const normalizedFile = file.replace(/\\/g, '/').toLowerCase()
      if (
        normalizedFile.includes('/src/data/solutions/') &&
        normalizedFile.endsWith('.json')
      ) {
        return []
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), manualSolutionReload()],
})

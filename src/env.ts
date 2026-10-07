// Imported first by cli.ts so keys are set before the API client is created.
import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
config({ path: join(ROOT, '.env'), quiet: true })

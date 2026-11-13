// Runs in each test worker before the test file: the database URLs of this run's fresh database.
import { inject } from 'vitest'

const urls = inject('databaseUrls')
process.env.DATABASE_URL = urls.app
process.env.DATABASE_URL_MIGRATE = urls.migrate
process.env.DATABASE_URL_SYSTEM = urls.system

import pino from 'pino'

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
  // In development (non-docker/local), you might pipe to pino-pretty manually
  // or configure transport here if detected.
  // For now we keep it standard JSON for best performance/docker compat.
})

export default logger

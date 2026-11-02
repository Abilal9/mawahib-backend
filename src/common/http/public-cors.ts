export function publicCorsOptions(origins: string[]) {
  return {
    origin: origins,
    credentials: true as const,
    exposedHeaders: ['Retry-After'],
  };
}

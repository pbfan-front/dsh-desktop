export interface BusinessPreviewResponse {
  timestamp: string
  statusCode: number
  profileId: string
  scenarioId: string
  path: string
  body: unknown
}

export interface BusinessPreviewNetworkCapture {
  navigate(url: string): Promise<unknown>
  reload(): Promise<unknown>
  tap(x: number, y: number): Promise<void>
  evaluate<T = unknown>(expression: string): Promise<T>
  readonly responses: BusinessPreviewResponse[]
  readonly observedMockPaths: Set<string>
  close(): Promise<void>
}

export function openBusinessPreviewNetwork(options: {
  chromePath: string
  requestPath: string
  mobileViewport?: { width: number; height: number; deviceScaleFactor: number }
  userAgent?: string
}): Promise<BusinessPreviewNetworkCapture>

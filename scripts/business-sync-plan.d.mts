export interface BusinessBuildStep {
  label: string
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export interface BusinessBuildPlanOptions {
  businessRoot: string
  webRoot: string
  nodeExecutable?: string
}

export function createBusinessBuildPlan(options: BusinessBuildPlanOptions): BusinessBuildStep[]

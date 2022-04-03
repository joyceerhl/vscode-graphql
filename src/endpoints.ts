import { NotebookDocument, workspace } from "vscode";
import { loadConfig, GraphQLProjectConfig } from "graphql-config"
import { Endpoint, Endpoints } from "graphql-config/extensions/endpoints"

export class EndpointsManager {
  async getConfiguredEndpoints(notebookDocument: NotebookDocument) {
    const result: {
      project: string,
      projectConfig: GraphQLProjectConfig,
      configDirPath: string
      endpointName: string
      endpointData: Endpoint
      isDefault: boolean 
    }[] = []

    if (notebookDocument.isUntitled) {
      await notebookDocument.save() // TODO@joyceerhl support running untitled notebooks?
    }

    const notebookDocumentUri = notebookDocument.uri
    const rootDir = workspace.getWorkspaceFolder(notebookDocumentUri)?.uri
      .fsPath
    const config = await loadConfig({ rootDir: rootDir })

    if (!config) {
      return
    }

    const projectConfig = config.getProjectForFile(notebookDocumentUri.fsPath)
    const endpoints: Endpoints =
      projectConfig.extensions.endpoints ??
      this.getDefaultEndpointFromSchema(projectConfig)

    for (const endpoint of Object.keys(endpoints)) {
      result.push({
        project: projectConfig.name,
        projectConfig: projectConfig,
        configDirPath: config.dirpath,
        endpointName: endpoint,
        endpointData: endpoints[endpoint],
        isDefault: endpoint === 'default',
      })
    }

    return result
  }

  private getDefaultEndpointFromSchema(projectConfig: GraphQLProjectConfig) {
    let schemas: string[] = []

    if (typeof projectConfig.schema === "string") {
      schemas = [projectConfig.schema]
    } else if (Array.isArray(projectConfig.schema)) {
      schemas = projectConfig.schema.map(s =>
        typeof s !== "string" ? s.toString() : s,
      )
    }

    for (const schema of schemas) {
      if (Boolean(schema.match(/^https?:\/\//g))) {
        return {
          default: {
            url: schema,
          },
        }
      }
    }
  }
}

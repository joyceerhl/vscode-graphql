import {
  Disposable,
  NotebookCell,
  NotebookController,
  NotebookControllerAffinity,
  NotebookDocument,
  notebooks,
  workspace,
} from "vscode"
import { EndpointsManager } from "./endpoints"

export class ControllerManager implements Disposable {
  private controllers = new Map<string, NotebookController>()
  private disposables: Disposable[] = []
  private endpoints: EndpointsManager;

  constructor() {
    this.endpoints = new EndpointsManager();

    this.disposables.push(
      workspace.onDidOpenNotebookDocument(async notebookDocument => {
        if (notebookDocument.notebookType === "gqlnb") {
          await this.ensureControllersFor(notebookDocument)
        }
      }),
    )
  }

  public dispose() {
    for (const controller of this.controllers.values()) {
      controller.dispose()
    }
    this.disposables.map(d => d.dispose())
  }

  private async ensureControllersFor(notebookDocument: NotebookDocument) {
    // TODO@joyceerhl watch changes to config files so we can cache endpoints instead of having to poll for them
    // and also so that controllers are updated in response to configuration changes
    const configuredEndpoints =
      (await this.endpoints.getConfiguredEndpoints(notebookDocument)) ?? []

    for (const endpoint of configuredEndpoints) {
      const id = `${endpoint.configDirPath} - ${endpoint.project} - ${endpoint.endpointName}`

      let controller = this.controllers.get(id)

      if (!controller) {
        controller = notebooks.createNotebookController(
          id,
          "gqlnb",
          endpoint.endpointName,
        )

        controller.executeHandler = (cells, notebook, controller) => this.execute(cells, notebook, controller);
        controller.kind = endpoint.project
        controller.supportedLanguages = ['graphql']

        this.controllers.set(id, controller)
      }

      if (endpoint.isDefault) {
        controller.updateNotebookAffinity(
          notebookDocument,
          NotebookControllerAffinity.Preferred,
        )
      }
    }
  }

  private async execute(cells: NotebookCell[], notebook: NotebookDocument, controller: NotebookController) {
    // TODO@joyceerhl Extract template literals
    // TODO@joyceerhl Resolve variables if any
    // TODO@joyceerhl Use network helper
    // TODO@joyceerhl Report output
  }
}

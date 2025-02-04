import {
  Disposable,
  NotebookCell,
  NotebookCellExecution,
  NotebookCellOutput,
  NotebookCellOutputItem,
  NotebookController,
  NotebookControllerAffinity,
  NotebookDocument,
  notebooks,
  OutputChannel,
  window,
  workspace,
} from "vscode"
import { EndpointsManager } from "./endpoints"
import { SourceHelper } from "./source-helper"
import { visit, VariableDefinitionNode } from "graphql"
import { NetworkHelper, UserVariables } from "./network-helper"
import { Endpoint } from "graphql-config/extensions/endpoints"
import { GraphQLProjectConfig } from "graphql-config"

export class ControllerManager implements Disposable {
  private controllers = new Map<string, NotebookController>()
  private configurations = new Map<
    string,
    { endpoint: Endpoint; projectConfig: GraphQLProjectConfig }
  >()
  private disposables: Disposable[] = []
  private endpoints: EndpointsManager
  private sourceHelper: SourceHelper
  private networkHelper: NetworkHelper

  constructor() {
    const outputChannel: OutputChannel = window.createOutputChannel(
      "GraphQL Notebooks",
    )

    this.endpoints = new EndpointsManager()
    this.sourceHelper = new SourceHelper(outputChannel)
    this.networkHelper = new NetworkHelper(outputChannel, this.sourceHelper)

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
          `${endpoint.project} - ${endpoint.endpointName}`,
        )

        controller.executeHandler = (cells, notebook, controller) =>
          this.execute(cells, notebook, controller)
        controller.supportedLanguages = ["graphql"]
        this.configurations.set(id, {
          endpoint: endpoint.endpointData,
          projectConfig: endpoint.projectConfig,
        })

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

  private async execute(
    cells: NotebookCell[],
    notebook: NotebookDocument,
    controller: NotebookController,
  ) {
    for (const cell of cells) {
      const task = controller.createNotebookCellExecution(cell)
      task.start(Date.now())
      let success = false

      // Clear any existing cell output if rerunning
      task.clearOutput(cell)

      try {
        const literals = this.sourceHelper.extractAllTemplateLiterals(
          cell.document,
        )

        if (literals.length === 0) {
          task.end(success, Date.now())
        }

        for (let i = 0; i < literals.length; i += 1) {
          const literal = literals[i]
          const updateCallback = async (data, operation) => {
            if (operation === "subscription") {
              // TODO: how do we know when a subscription has finished?
              await this.appendOutput(task, data)
            } else {
              if (!data.startsWith("Error")) {
                success = true
                await this.appendOutput(task, data)
              } else {
                await this.reportError(task, new Error(data))
              }

              if (i === literals.length - 1) {
                task.end(success, Date.now())
              }
            }
          }

          let variableDefinitionNodes: VariableDefinitionNode[] = []
          const { endpoint, projectConfig } = this.configurations.get(
            controller.id,
          )!
          visit(literal.ast, {
            VariableDefinition(node: VariableDefinitionNode) {
              variableDefinitionNodes.push(node)
            },
          })

          if (variableDefinitionNodes.length > 0) {
            const variables = await this.getVariablesFromUser(
              variableDefinitionNodes,
            )

            await this.networkHelper.executeOperation({
              endpoint,
              literal: literal,
              variables,
              updateCallback,
              projectConfig,
            })
          } else {
            await this.networkHelper.executeOperation({
              endpoint,
              literal: literal,
              variables: {},
              updateCallback,
              projectConfig,
            })
          }
        }
      } catch (e) {
        success = false
        await this.reportError(
          task,
          e instanceof Error ? e : new Error(e as string),
        )
        task.end(success, Date.now())
      }
    }
  }

  private async appendOutput(task: NotebookCellExecution, jsonData: string) {
    function createItem() {
      try {
        const parsed = JSON.parse(jsonData)
        const stringified = JSON.stringify(parsed["data"], undefined, 4)
        const data = Buffer.from(stringified)
        return new NotebookCellOutputItem(data, "text/x-json")
      } catch (ex) {
        return NotebookCellOutputItem.error(ex as Error)
      }
    }

    const item = createItem()
    const output = new NotebookCellOutput([item])
    await task.appendOutput(output)
  }

  private async reportError(task: NotebookCellExecution, error: Error) {
    const item = NotebookCellOutputItem.error(error)
    const output = new NotebookCellOutput([item])
    await task.replaceOutput(output)
  }

  private async getVariablesFromUser(
    variableDefinitionNodes: VariableDefinitionNode[],
  ): Promise<UserVariables> {
    let variables = {}
    for (let node of variableDefinitionNodes) {
      const variableType = this.sourceHelper.getTypeForVariableDefinitionNode(
        node,
      )
      variables = {
        ...variables,
        [`${node.variable.name.value}`]: this.sourceHelper.typeCast(
          (await window.showInputBox({
            ignoreFocusOut: true,
            placeHolder: `Please enter the value for ${node.variable.name.value}`,
            validateInput: async (value: string) =>
              this.sourceHelper.validate(value, variableType),
          })) as string,
          variableType,
        ),
      }
    }
    return variables
  }
}

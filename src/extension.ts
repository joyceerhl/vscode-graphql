"use strict"
import * as path from "path"
import {
  workspace,
  ExtensionContext,
  window,
  commands,
  OutputChannel,
  languages,
  Uri,
  ViewColumn,
  notebooks,
  NotebookCellOutput,
  NotebookCellOutputItem,
  NotebookCellExecution,
} from "vscode"
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  RevealOutputChannelOn,
} from "vscode-languageclient"

import statusBarItem, { initStatusBar } from "./status"

import { GraphQLContentProvider } from "./client/graphql-content-provider"
import { GraphQLCodeLensProvider } from "./client/graphql-codelens-provider"
import { ExtractedTemplateLiteral, SourceHelper } from "./client/source-helper"
import { CustomInitializationFailedHandler } from "./CustomInitializationFailedHandler"
import { NotebookSerializer } from "./client/notebook-serializer"

function getConfig() {
  return workspace.getConfiguration(
    "vscode-graphql",
    window.activeTextEditor ? window.activeTextEditor.document.uri : null,
  )
}

export function activate(context: ExtensionContext) {
  let outputChannel: OutputChannel = window.createOutputChannel(
    "GraphQL Language Server",
  )
  const config = getConfig()
  const { debug } = config

  if (debug) {
    console.log('Extension "vscode-graphql" is now active!')
  }

  const serverModule = context.asAbsolutePath(
    path.join("out/server", "server.js"),
  )

  const debugOptions = {
    execArgv: ["--nolazy", "--inspect=localhost:6009"],
  }

  let serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { ...(debug ? debugOptions : {}) },
    },
  }

  let clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "graphql" },
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "javascriptreact" },
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "typescriptreact" },
    ],
    synchronize: {
      // TODO: should this focus on `graphql-config` documents, schema and/or includes?
      fileEvents: [
        workspace.createFileSystemWatcher(
          "/{graphql.config.*,.graphqlrc,.graphqlrc.*,package.json}",
          false,
          // ignore change events for graphql config, we only care about create, delete and save events
          true,
        ),
        // these ignore node_modules and .git by default
        workspace.createFileSystemWatcher(
          "**/{*.graphql,*.graphqls,*.gql,*.js,*.mjs,*.cjs,*.esm,*.es,*.es6,*.jsx,*.ts,*.tsx}",
        ),
      ],
    },
    outputChannel: outputChannel,
    outputChannelName: "GraphQL Language Server",
    revealOutputChannelOn: RevealOutputChannelOn.Never,
    initializationFailedHandler: CustomInitializationFailedHandler(
      outputChannel,
    ),
  }

  const client = new LanguageClient(
    "vscode-graphql",
    "GraphQL Language Server",
    serverOptions,
    clientOptions,
    debug,
  )

  let clientLSPDisposable = client.start()
  context.subscriptions.push(clientLSPDisposable)

  const commandIsDebugging = commands.registerCommand(
    "vscode-graphql.isDebugging",
    () => {
      outputChannel.appendLine(`is in debug mode: ${!!debug}`)
    },
  )
  context.subscriptions.push(commandIsDebugging)

  const commandShowOutputChannel = commands.registerCommand(
    "vscode-graphql.showOutputChannel",
    () => {
      outputChannel.show()
    },
  )
  context.subscriptions.push(commandShowOutputChannel)

  const serializer = new NotebookSerializer()
	context.subscriptions.push(workspace.registerNotebookSerializer('gqlnb', serializer))

	const commandCreateNotebook = commands.registerCommand('vscode-graphql.createNotebook', async () => {
		const data = serializer.createNew()
		const notebookDocument = await workspace.openNotebookDocument('gqlnb', data)
		await commands.executeCommand('vscode.openWith', notebookDocument.uri, 'gqlnb')
	})
  context.subscriptions.push(commandCreateNotebook)

  async function replaceOutput(task: NotebookCellExecution, jsonData: string) {
    const parsed = JSON.parse(jsonData);
    const stringified = JSON.stringify(parsed['data'], undefined, 4);
    const data = Buffer.from(stringified);
    const item = new NotebookCellOutputItem(data, 'text/x-json');
    const output = new NotebookCellOutput([item]);
    await task.replaceOutput(output);
  }  

  notebooks.createNotebookController('GraphQL', 'gqlnb', 'GraphQL', async (cells, notebook, controller) => {
    const sourceHelper = new SourceHelper(outputChannel);
    for (const cell of cells) {
      const literals = sourceHelper.extractAllTemplateLiterals(cell.document);
      for (const literal of literals) {
        const task = controller.createNotebookCellExecution(cell);
        task.start(Date.now());
        let success = false
        try {
          const uri = Uri.parse("graphql://authority/graphql")
  
          const contentProvider = new GraphQLContentProvider(
            uri,
            outputChannel,
            literal,
          )

          await contentProvider.loadProvider(async (data, operation) => {
            if (operation === "subscription") { // TODO: how do we know when a subscription has finished?
              const item = new NotebookCellOutputItem(Buffer.from(data), 'text/x-json');
              await task.appendOutputItems(item, cell.outputs[cell.outputs.length - 1]);
            } else {
              success = true
              await replaceOutput(task, data);
              task.end(success, Date.now());
            }
          });
        } catch (e) {
          success = false
          task.end(success, Date.now())
        }
      }
    }
  });

  // Manage Status Bar
  context.subscriptions.push(statusBarItem)
  client.onReady().then(() => {
    initStatusBar(statusBarItem, client, window.activeTextEditor)
  })

  const settings = workspace.getConfiguration("vscode-graphql")

  const registerCodeLens = () => {
    context.subscriptions.push(
      languages.registerCodeLensProvider(
        [
          "javascript",
          "typescript",
          "javascriptreact",
          "typescriptreact",
          "graphql",
        ],
        new GraphQLCodeLensProvider(outputChannel),
      ),
    )
  }

  if (settings.showExecCodelens) {
    registerCodeLens()
  }

  workspace.onDidChangeConfiguration(() => {
    const newSettings = workspace.getConfiguration("vscode-graphql")
    if (newSettings.showExecCodeLens) {
      registerCodeLens()
    }
  })

  const commandContentProvider = commands.registerCommand(
    "vscode-graphql.contentProvider",
    async (literal: ExtractedTemplateLiteral) => {
      const uri = Uri.parse("graphql://authority/graphql")

      const panel = window.createWebviewPanel(
        "vscode-graphql.results-preview",
        "GraphQL Execution Result",
        ViewColumn.Two,
        {},
      )

      const contentProvider = new GraphQLContentProvider(
        uri,
        outputChannel,
        literal,
        panel,
      )
      const registration = workspace.registerTextDocumentContentProvider(
        "graphql",
        contentProvider,
      )
      context.subscriptions.push(registration)

      const html = await contentProvider.getCurrentHtml()
      panel.webview.html = html
    },
  )
  context.subscriptions.push(commandContentProvider)

  commands.registerCommand("vscode-graphql.restart", async () => {
    outputChannel.appendLine(`Stopping GraphQL LSP`)
    await client.stop()
    clientLSPDisposable.dispose()

    outputChannel.appendLine(`Restarting GraphQL LSP`)
    clientLSPDisposable = await client.start()
    context.subscriptions.push(clientLSPDisposable)

    outputChannel.appendLine(`GraphQL LSP restarted`)
  })
}

export function deactivate() {
  console.log('Extension "vscode-graphql" is now de-active!')
}

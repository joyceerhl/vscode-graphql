# VS Code GraphQL Notebooks

Run and execute GraphQL queries and mutations in a VS Code notebook interface ✨

## Features

### General features

- Create VS Code Notebook using the File > New File... menu or the `GraphQL: Create New GraphQL Notebook` command
- Select notebook controller from configured endpoints in project `graphql-config`
- Execute queries and mutations against selected controller endpoint
- View execution results as notebook output

## Usage

Install the [VS Code GraphQL Notebooks Extension](https://marketplace.visualstudio.com/items?itemName=joyceerhl.vscode-graphql-notebook).

**This extension requires a graphql-config file**.

As of `vscode-graphql@0.3.0` we support `graphql-config@3`. You can read more about that [here](https://www.graphql-config.com/docs/user/user-usage). Because it now uses `cosmicconfig` there are plenty of new options for loading config files:

```
graphql.config.json
graphql.config.js
graphql.config.yaml
graphql.config.yml
.graphqlrc (YAML or JSON)
.graphqlrc.json
.graphqlrc.yaml
.graphqlrc.yml
.graphqlrc.js
graphql property in package.json
```

As with the [VS Code GraphQL extension](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql), the configuration file needs to be placed at the project root by default, but you can configure paths per project. See the FAQ below for details.

If you need legacy support for `.graphqlconfig` files or older graphql-config formats, see [this FAQ answer](#legacy). If you are missing legacy `graphql-config` features, please consult [the `graphql-config` repository](https://github.com/kamilkisiela/graphql-config).

## Configuration Examples

### Simple Example

```yaml
# .graphqlrc.yml
schema: "schema.graphql"
documents: "src/**/*.{gqlnb}"
```

### Advanced Example

```js
// graphql.config.js
module.exports = {
  projects: {
    app: {
      schema: ["src/schema.graphql", "directives.graphql"],
      documents: ["**/*.{graphql,js,ts,jsx,tsx,gqlnb}", "my/fragments.graphql"],
      extensions: {
        endpoints: {
          default: {
            url: "http://localhost:8000",
            headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
          },
        },
      },
    },
    db: {
      schema: "src/generated/db.graphql",
      documents: ["src/db/**/*.gqlnb", "my/fragments.graphql"],
      extensions: {
        codegen: [
          {
            generator: "graphql-binding",
            language: "typescript",
            output: {
              binding: "src/generated/db.ts",
            },
          },
        ],
        endpoints: {
          default: {
            url: "http://localhost:8080",
            headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
          },
        },
      },
    },
  },
}
```

Notice that `documents` key supports glob pattern and hence `["**/*.gqlnb"]` is also valid.

## Frequently Asked Questions

<span id="legacy" />

### I can't load `.graphqlconfig` files anymore

If you need to use a legacy config file, then you just need to enable legacy mode for `graphql-config`:

```json
"graphql-config.load.legacy": true
```

### The extension fails with errors about duplicate types

Make sure that you aren't including schema files in the `documents` blob

### The extension fails with errors about missing scalars, directives, etc

Make sure that your `schema` pointers refer to a complete schema!

### "Execute Query/Mutation/Subscription" always fails

The best way to make "execute <op type>" codelens work is to add endpoints config to the global graphql config or the project config.

This would look like:

```ts
export default {
  schema: "mschema.graphql",
  extension: {
    endpoints: {
      default: "http://localhost:9000",
    },
  },
}
```

(see above for per-project examples)

If there is an issue with execution that has to do with your server, the error response should show now in the result panel.

In case the request fails due to self signed certificate, you can bypass that check by adding this to your settings:

```json
"vscode-graphql.rejectUnauthorized": false
```

### My GraphQL config file is not at the root

Good news, we have configs for this now!

You can search a folder for any of the matching config file names listed above:

```json
"graphql-config.load.rootDir": "./config"
```

Or a specific filepath:

```json
"graphql-config.load.filePath": "./config/my-graphql-config.js"
```

Or a different `configName` that allows different formats:

```json
"graphql-config.load.rootDir": "./config",
"graphql-config.load.configName": "acme"
```

which would search for `./config/.acmerc`, `.config/.acmerc.js`, `.config/acme.config.json`, etc matching the config paths above

If you have multiple projects, you need to define one top-level config that defines all project configs using `projects`

### Template literal expressions dont work with `Execute Query`

Experimental support for template literal expressions ala `${}` has been added for language support, which just add an empty newline behind the scenes. It does not yet work for `Execute Query` codelans.

## Development

1.  Clone the repository - https://github.com/joyceerhl/vscode-graphql-notebook
1.  `npm install`
1.  Open it in VS Code
1.  Go to the debugging section and run the launch program "Extension"
1.  This will open another VS Code instance with the extension enabled
1.  Create or open a GraphQL notebook
1.  Logs for GraphQL Notebooks will appear in output section under GraphQL Notebooks

## License

MIT

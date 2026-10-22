/**
 * The server as a library: for the tests, which call it against a real
 * schema, and for a host that mounts it on a transport of its own.
 */
export { ENV, readConfig, refuseServiceRole, scopesOf, verifyAccessToken, type Config } from './config.js';
export {
  AUTHORIZATION_SERVER_PATH,
  PROTECTED_RESOURCE_PATH,
  SCOPES,
  authorizationServerMetadata,
  handleHttpRequest,
  handleNodeRequest,
  protectedResourceMetadata,
  type AuthorizationServerMetadata,
  type HttpOptions,
} from './http.js';
export { ALL_TOOLS, INSTRUCTIONS, SERVER_NAME, SERVER_VERSION, buildServer, instructionsFor, type ServerOptions } from './server.js';
export { SCHEMA_MIN } from './schema.js';
export { openSession, serverFromEnvironment, type StartOptions, type Started } from './start.js';
export { isMissingConfiguration, unconfiguredSession } from './unconfigured.js';
export { MODULE_TOOLS, moduleToolsFor } from './tools/modules.js';
export { READ_TOOLS } from './tools/read.js';
export { WRITE_TOOLS } from './tools/write.js';
export type { Tool, ToolContext } from './tools/tool.js';

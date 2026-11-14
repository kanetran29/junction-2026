import { createApp } from './http/routes';
import { mcpRoutes } from './mcp/tools';

const app = createApp();
app.route('/', mcpRoutes());

export default app;

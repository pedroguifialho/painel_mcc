import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import fs from 'fs'
import path from 'path'

// Custom plugin to act as a mini backend for saving DDA imports
function ddaPersistencePlugin() {
    return {
        name: 'dda-persistence',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                // Intercept POST to /api/save-dda
                if (req.url === '/api/save-dda' && req.method === 'POST') {
                    let body = '';
                    req.on('data', chunk => {
                        body += chunk.toString();
                    });
                    req.on('end', () => {
                        try {
                            const newRecords = JSON.parse(body);

                            const dataPath = path.resolve(__dirname, 'src/data/dda-imported.json');

                            // Ensure directory exists
                            if (!fs.existsSync(path.dirname(dataPath))) {
                                fs.mkdirSync(path.dirname(dataPath), { recursive: true });
                            }

                            // Read existing
                            let existingRecords = [];
                            if (fs.existsSync(dataPath)) {
                                existingRecords = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                            }

                            // Append and save
                            const updatedRecords = [...existingRecords, ...newRecords];
                            fs.writeFileSync(dataPath, JSON.stringify(updatedRecords, null, 2), 'utf8');

                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ success: true, count: newRecords.length }));
                        } catch (err) {
                            res.statusCode = 500;
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ success: false, error: err.message }));
                        }
                    });
                } else {
                    next();
                }
            });
        }
    }
}

export default defineConfig({
    plugins: [react(), ddaPersistencePlugin()],
})

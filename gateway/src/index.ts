import dotenv from 'dotenv';
import { buildApp } from './app.js';

dotenv.config();

const fastify = await buildApp({ logger: true });

const start = async () => {
  try {
    await fastify.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

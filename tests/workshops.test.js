import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setupTestDB, teardownTestDB, clearDatabase } from './setup.js';

describe('1. Workshops API', () => {
  let app;

  beforeAll(async () => {
    await setupTestDB();
    app = createApp();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  it('creates and retrieves a workshop successfully', async () => {
    const payload = {
      title: 'Microservices & Distributed Systems',
      description: 'Hands-on architectural patterns',
      organizerId: 'organizer-42',
    };

    const res = await request(app)
      .post('/api/workshops')
      .send(payload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.workshopId).toBeDefined();
    expect(res.body.data.title).toBe(payload.title);
    expect(res.body.data.status).toBe('active');

    const workshopId = res.body.data.workshopId;

    // Retrieve by ID
    const getRes = await request(app)
      .get(`/api/workshops/${workshopId}`)
      .expect(200);

    expect(getRes.body.success).toBe(true);
    expect(getRes.body.data.workshopId).toBe(workshopId);
    expect(getRes.body.data.title).toBe(payload.title);

    // List all workshops
    const listRes = await request(app)
      .get('/api/workshops')
      .expect(200);

    expect(listRes.body.success).toBe(true);
    expect(listRes.body.count).toBe(1);
    expect(listRes.body.data[0].workshopId).toBe(workshopId);
  });

  it('rejects workshop creation with missing or empty fields', async () => {
    const res = await request(app)
      .post('/api/workshops')
      .send({ title: '', organizerId: 'org-1' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  it('returns 404 for unknown workshop ID', async () => {
    const res = await request(app)
      .get('/api/workshops/non-existent-id')
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it('lists registered members for a workshop (GET /api/workshops/:id/registrations)', async () => {
    // 1. Create a workshop
    const wsRes = await request(app)
      .post('/api/workshops')
      .send({
        title: 'Kubernetes Patterns',
        description: 'Deep dive into orchestrations',
        organizerId: 'org-k8s',
      })
      .expect(201);

    const workshopId = wsRes.body.data.workshopId;

    // 2. Initially 0 registrations
    const emptyRes = await request(app)
      .get(`/api/workshops/${workshopId}/registrations`)
      .expect(200);

    expect(emptyRes.body.success).toBe(true);
    expect(emptyRes.body.count).toBe(0);
    expect(emptyRes.body.data).toEqual([]);

    // 3. Register two members
    await request(app)
      .post(`/api/workshops/${workshopId}/registrations`)
      .send({ memberId: 'member-alpha', destination: 'alpha@example.com' })
      .expect(201);

    await request(app)
      .post(`/api/workshops/${workshopId}/registrations`)
      .send({ memberId: 'member-beta', destination: 'beta@example.com' })
      .expect(201);

    // 4. Retrieve list of registered members
    const listRes = await request(app)
      .get(`/api/workshops/${workshopId}/registrations`)
      .expect(200);

    expect(listRes.body.success).toBe(true);
    expect(listRes.body.count).toBe(2);
    expect(listRes.body.data.map((r) => r.memberId).sort()).toEqual(['member-alpha', 'member-beta']);
  });

  it('returns 404 when listing registrations for non-existent workshop', async () => {
    const res = await request(app)
      .get('/api/workshops/non-existent-workshop/registrations')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/not found/i);
  });

  it('reports healthy application and database status (GET /api/health)', async () => {
    const res = await request(app)
      .get('/api/health')
      .expect(200);

    expect(res.body.status).toBe('healthy');
    expect(res.body.timestamp).toBeDefined();
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(res.body.database).toBeDefined();
    expect(res.body.database.status).toBe('connected');
    expect(res.body.database.readyState).toBe(1);
  });
});


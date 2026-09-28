import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_FOR_MODEL, GET, handle } from '../../../api/world.ts';
import { PLAN_CATALOG } from '../index.ts';

const req = (body: unknown) => new Request('http://x/api/world', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('fonction serveur /api/world (fournisseur IA)', () => {
  it('le catalogue donné au modèle est exactement celui du composer', () => {
    assert.deepEqual(Object.keys(CATALOG_FOR_MODEL).sort(), Object.keys(PLAN_CATALOG).sort());
  });

  it('sans ANTHROPIC_API_KEY : état « non configuré » et refus explicite (503), aucun faux plan', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(((await GET().json()) as { configured: boolean }).configured, false);
    let called = false;
    const res = await handle(req({ mode: 'plan', prompt: 'Un salon' }), (async () => ((called = true), new Response('{}'))) as typeof fetch);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, 'AI_NOT_CONFIGURED');
    assert.match(body.message, /ANTHROPIC_API_KEY/);
    assert.equal(called, false);
  });

  it('avec clé : appel Anthropic avec outil imposé, renvoie le plan tel que produit', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    let sent: { url: string; headers: Record<string, string>; body: { tool_choice: { name: string }; tools: { name: string }[]; messages: { content: string }[] } } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'emit_scene_plan', input: { version: 1, title: 'X', sceneType: 'interior', zones: [], objects: [] } }], usage: { input_tokens: 1 } }));
    }) as unknown as typeof fetch;
    const res = await handle(req({ mode: 'plan', prompt: 'Un petit salon' }), fake);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { plan: { title: string } }).plan.title, 'X');
    assert.equal(sent!.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(sent!.headers['x-api-key'], 'test-key');
    assert.equal(sent!.body.tool_choice.name, 'emit_scene_plan');
    assert.equal(sent!.body.messages[0].content, 'Un petit salon');
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('erreur du fournisseur → 502 avec message ; entrée invalide → 400', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const fail = (async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })) as unknown as typeof fetch;
    const r1 = await handle(req({ mode: 'plan', prompt: 'Un salon' }), fail);
    assert.equal(r1.status, 502);
    assert.match(((await r1.json()) as { message: string }).message, /invalid x-api-key/);
    const r2 = await handle(req({ mode: 'plan', prompt: '' }), fail);
    assert.equal(r2.status, 400);
    const r3 = await handle(req({ mode: 'plan', prompt: 'x'.repeat(5000) }), fail);
    assert.equal(r3.status, 400);
    const noTool = (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'bonjour' }], stop_reason: 'end_turn' }))) as unknown as typeof fetch;
    assert.equal((await handle(req({ mode: 'plan', prompt: 'Un salon' }), noTool)).status, 502);
    delete process.env.ANTHROPIC_API_KEY;
  });
});

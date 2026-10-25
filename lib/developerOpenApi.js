import { carouselDocumentation } from './social/carouselDocumentation.js';
const origin = (process.env.PUBLIC_HOST || 'https://veyrnox.ai').replace(/\/$/, '');
const oauthOrigin = (process.env.SUPABASE_URL || 'https://xdxdzmsztyzbnzeforxx.supabase.co').replace(/\/$/, '');

const json = { 'application/json': { schema: { type: 'object', additionalProperties: true } } };
const response = (description) => ({ description, content: json });
const secured = [{ oauth: ['openid', 'email', 'profile'] }];

export const developerOpenApi = {
    openapi: '3.1.0',
    info: {
        title: 'Veyrnox Developer API', version: '1.0.0',
        description: 'Generate AI media, inspect jobs and download owned assets. OAuth 2.1 access tokens are required.',
    },
    servers: [{ url: `${origin}/api/v1/developer` }],
    externalDocs: { description: 'Veyrnox developer guide', url: `${origin}/developers` },
    components: {
        securitySchemes: {
            oauth: {
                type: 'oauth2',
                flows: { authorizationCode: {
                    authorizationUrl: `${oauthOrigin}/auth/v1/oauth/authorize`,
                    tokenUrl: `${oauthOrigin}/auth/v1/oauth/token`,
                    scopes: { openid: 'Identify the signed-in user', email: 'Read the account email', profile: 'Read basic profile data' },
                } },
            },
        },
    },
    security: secured,
    paths: {
        '/': { get: { operationId: 'getApi', summary: 'Describe the API', responses: { 200: response('API links') } } },
        '/me': { get: { operationId: 'getMe', summary: 'Read the authenticated developer identity', responses: { 200: response('Identity') } } },
        '/models': { get: { operationId: 'listModels', summary: 'List active media models and prices', responses: { 200: response('Model catalog') } } },
        '/estimates': { post: {
            operationId: 'estimateGeneration', summary: 'Calculate the maximum credit charge',
            requestBody: { required: true, content: { 'application/json': { schema: {
                type: 'object', required: ['model_id'], properties: { model_id: { type: 'string' }, duration_seconds: { type: 'integer', minimum: 1, maximum: 600 } },
            } } } }, responses: { 200: response('Credit estimate'), 400: response('Invalid request'), 404: response('Model not found') },
        } },
        '/balance': { get: { operationId: 'getBalance', summary: 'Read the account credit balance', responses: { 200: response('Credit balance') } } },
        '/generations': {
            get: { operationId: 'listGenerations', summary: 'List owned generations', parameters: [
                { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
                { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
                { name: 'before_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            ], responses: { 200: response('Generation page') } },
            post: {
                operationId: 'createGeneration', summary: 'Create a generation after confirming its maximum credit charge',
                requestBody: { required: true, content: { 'application/json': { schema: {
                    type: 'object', required: ['model_id', 'idempotency_key', 'confirmed_credits', 'inputs'],
                    properties: { model_id: { type: 'string' }, idempotency_key: { type: 'string', minLength: 8, maxLength: 128 },
                        confirmed_credits: { type: 'integer', minimum: 0 }, inputs: { type: 'object' }, consent: { type: 'boolean' },
                        source_assets: { type: 'array', maxItems: 2, items: { type: 'object', required: ['slot', 'asset_id'],
                            properties: { slot: { type: 'string', enum: ['image', 'endImage', 'video', 'audio'] }, asset_id: { type: 'string', format: 'uuid' } } } } },
                } } } }, responses: { 200: response('Created or replayed generation'), 400: response('Invalid request'),
                    402: response('Insufficient credits'), 409: response('Price confirmation mismatch'), 429: response('Rate limited') },
            },
        },
        '/generations/{job_id}': { get: {
            operationId: 'getGeneration', summary: 'Read an owned generation',
            parameters: [{ name: 'job_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            responses: { 200: response('Generation state'), 404: response('Not found') },
        } },
        '/generations/{job_id}/asset': { get: {
            operationId: 'getGenerationAsset', summary: 'Create a short-lived download URL for an owned asset',
            parameters: [{ name: 'job_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
                { name: 'download', in: 'query', schema: { type: 'string', enum: ['1'] } }],
            responses: { 200: response('Presigned asset URL'), 404: response('Not found') },
        } },
        '/publish/brands': { get: { operationId: 'listPublishBrands', summary: 'List Publish brands you can act on (needs the Publish automation switch)', responses: { 200: response('Brands'), 404: response('Publish automation not open') } } },
        '/publish/accounts': { get: { operationId: 'listPublishAccounts', summary: 'List connected social accounts',
            parameters: [{ name: 'brand_id', in: 'query', schema: { type: 'string', format: 'uuid' } }],
            responses: { 200: response('Accounts'), 404: response('Publish automation not open') } } },
        '/publish/posts': {
            get: { operationId: 'listPublishPosts', summary: 'List posts in a window of at most 43 days (Publish Plan)',
                parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['scheduled', 'published', 'failed', 'canceled'] } },
                    { name: 'network', in: 'query', schema: { type: 'string' } },
                    { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
                    { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
                    { name: 'brand_id', in: 'query', schema: { type: 'string', format: 'uuid' } }],
                responses: { 200: response('Posts with updated_at'), 402: response('Publish Plan required') } },
            post: { operationId: 'schedulePublishPost', summary: 'Schedule a post at least 10 minutes ahead; never posts immediately (Publish Plan)',
                requestBody: { required: true, content: { 'application/json': { schema: {
                    type: 'object', required: ['scheduled_at', 'account_ids', 'media', 'idempotency_key'],
                    properties: { scheduled_at: { type: 'string', format: 'date-time' }, text: { type: 'string', maxLength: 4000 },
                        account_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 20 },
                        media: { type: 'array', description: carouselDocumentation(), minItems: 1, maxItems: 10, items: { type: 'object', required: ['media_type'], properties: {
                            media_type: { type: 'string', enum: ['image', 'video'] }, job_id: { type: 'string', format: 'uuid' }, upload_id: { type: 'string', format: 'uuid' } } } },
                        idempotency_key: { type: 'string' }, brand_id: { type: 'string', format: 'uuid' } },
                } } } },
                responses: { 201: response('Scheduled'), 400: response('Invalid request'), 402: response('Publish Plan required'), 404: response('Account or media not found'), 429: response('Rate limited') } },
        },
        '/publish/posts/{post_id}/reschedule': { post: { operationId: 'reschedulePublishPost', summary: 'Move a scheduled post (Publish Plan)',
            parameters: [{ name: 'post_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['scheduled_at', 'expected_at'],
                properties: { scheduled_at: { type: 'string', format: 'date-time' }, expected_at: { type: 'string', format: 'date-time' }, brand_id: { type: 'string', format: 'uuid' } } } } } },
            responses: { 200: response('Rescheduled'), 409: response('Post changed or already started') } } },
        '/publish/posts/{post_id}/cancel': { post: { operationId: 'cancelPublishPost', summary: 'Cancel a scheduled post (Publish Plan)',
            parameters: [{ name: 'post_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
            requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expected_updated_at'],
                properties: { expected_updated_at: { type: 'string', format: 'date-time' }, brand_id: { type: 'string', format: 'uuid' } } } } } },
            responses: { 200: response('Canceled'), 409: response('Post changed or already started') } } },
        '/publish/analytics': { get: { operationId: 'getPublishAnalytics', summary: 'Analytics summary for one account (Publish Plan)',
            parameters: [{ name: 'account_id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
                { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
                { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'date' } }],
            responses: { 200: response('Summary'), 402: response('Publish Plan required') } } },
    },
};

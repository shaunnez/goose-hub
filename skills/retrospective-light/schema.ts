import { RetroOutputBaseSchema } from '@goose-hub/core/retrospective/schemas.js';
import type { z } from 'zod';

export const LightRetroSchema = RetroOutputBaseSchema;

export type LightRetroOutput = z.infer<typeof LightRetroSchema>;

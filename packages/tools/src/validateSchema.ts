import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

/**
 * Validates a story pack against its JSON schema
 */
export function validateStoryPackSchema(storyPack: any): {
  valid: boolean;
  errors: string[];
} {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const workspaceRoot = resolve(__dirname, '../../..');
  const schemaPath = join(workspaceRoot, 'schemas/storypack.schema.json');

  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  const valid = validate(storyPack);

  const errors: string[] = [];
  if (!valid && validate.errors) {
    for (const error of validate.errors) {
      const path = error.instancePath || error.schemaPath;
      errors.push(`${path}: ${error.message}`);
    }
  }

  return { valid, errors };
}

/**
 * Validates a game save against its JSON schema
 */
export function validateGameSaveSchema(gameSave: any): {
  valid: boolean;
  errors: string[];
} {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const workspaceRoot = resolve(__dirname, '../../..');
  const schemaPath = join(workspaceRoot, 'schemas/gamesave.schema.json');

  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  // Note: gamesave schema references other schemas (party, actor, item)
  // For now, we'll validate what we can. Full validation would require loading all referenced schemas.
  const validate = ajv.compile(schema);
  const valid = validate(gameSave);

  const errors: string[] = [];
  if (!valid && validate.errors) {
    for (const error of validate.errors) {
      const path = error.instancePath || error.schemaPath;
      errors.push(`${path}: ${error.message}`);
    }
  }

  return { valid, errors };
}


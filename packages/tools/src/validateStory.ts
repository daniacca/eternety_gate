import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateStoryPackSchema } from './validateSchema.js';
import { validateStoryPackSemantics } from './validateSemantics.js';

/**
 * Validates a story pack file (schema + semantics)
 */
async function validateStory() {
  // Resolve from workspace root (two levels up from packages/tools/src)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const workspaceRoot = resolve(__dirname, '../../..');
  const storyPath = join(workspaceRoot, 'stories/brunholt.story.json');

  try {
    console.log(`Loading story from: ${storyPath}`);
    const storyContent = readFileSync(storyPath, 'utf-8');
    const story = JSON.parse(storyContent);

    console.log(`\n📖 Validating story: ${story.id || 'unknown'}`);
    console.log(`   Title: ${story.title || 'N/A'}`);
    console.log(`   Version: ${story.version || 'N/A'}\n`);

    let hasErrors = false;
    let hasWarnings = false;

    // Schema validation
    console.log('🔍 Schema validation...');
    const schemaResult = validateStoryPackSchema(story);
    if (!schemaResult.valid) {
      hasErrors = true;
      console.error('❌ Schema validation failed:');
      for (const error of schemaResult.errors) {
        console.error(`   ${error}`);
      }
    } else {
      console.log('✅ Schema validation passed\n');
    }

    // Semantic validation
    console.log('🔍 Semantic validation...');
    const semanticIssues = validateStoryPackSemantics(story);
    
    const errors = semanticIssues.filter(i => i.type === 'error');
    const warnings = semanticIssues.filter(i => i.type === 'warning');

    if (errors.length > 0) {
      hasErrors = true;
      console.error(`❌ Found ${errors.length} semantic error(s):`);
      for (const error of errors) {
        const pathStr = error.path ? ` (${error.path})` : '';
        console.error(`   ${error.message}${pathStr}`);
      }
    }

    if (warnings.length > 0) {
      hasWarnings = true;
      console.warn(`⚠️  Found ${warnings.length} semantic warning(s):`);
      for (const warning of warnings) {
        const pathStr = warning.path ? ` (${warning.path})` : '';
        console.warn(`   ${warning.message}${pathStr}`);
      }
    }

    if (errors.length === 0 && warnings.length === 0) {
      console.log('✅ Semantic validation passed\n');
    } else {
      console.log('');
    }

    // Summary
    if (hasErrors) {
      console.error('❌ Validation failed with errors');
      process.exit(1);
    } else if (hasWarnings) {
      console.warn('⚠️  Validation passed with warnings');
      process.exit(0);
    } else {
      console.log('✅ All validations passed!');
      process.exit(0);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Validation error:', error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error('❌ Validation error:', error);
    }
    process.exit(1);
  }
}

validateStory();

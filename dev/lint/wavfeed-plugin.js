// The house rules no built-in oxlint rule covers (docs/V2-PLAN.md section 7): a catch that drops its error without a
// word, a double cast through unknown, a named re-export, and the two Expo rules that keep EXPO_PUBLIC_ values
// inlinable, written here after eslint-plugin-expo's so the repo needs no ESLint.
const containsThrow = (node) => {
  if (Array.isArray(node)) return node.some(containsThrow);
  if (typeof node !== 'object' || node === null) return false;
  if (node.type === 'ThrowStatement') return true;
  if (typeof node.type === 'string' && node.type.includes('Function')) return false;
  return Object.entries(node).some(([key, value]) => key !== 'parent' && containsThrow(value));
};

const isProcessEnv = (node) =>
  node?.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && node.object.name === 'process' && node.property.name === 'env';

const RE_EXPORT = 'No re-exports. Import from the module that defines the symbol.';

export default {
  meta: { name: 'wavfeed' },
  rules: {
    'no-swallowed-catch': {
      create: (context) => ({
        CatchClause(node) {
          if (containsThrow(node.body) || context.sourceCode.getCommentsInside(node.body).length > 0) return;
          context.report({ node, message: 'This catch drops the error. Rethrow with new Error(msg, { cause }), or say in one line inside the catch why dropping it is right.' });
        },
      }),
    },
    'no-double-cast': {
      create: (context) => ({
        TSAsExpression(node) {
          if (node.expression.type === 'TSAsExpression' && node.expression.typeAnnotation.type === 'TSUnknownKeyword')
            context.report({ node, message: 'as unknown as T hides a type error. Parse the value (asRecord in src/domain/wire.ts, a schema) or fix the type at its source.' });
        },
      }),
    },
    'no-re-export': {
      create: (context) => ({
        ExportAllDeclaration(node) {
          context.report({ node, message: RE_EXPORT });
        },
        ExportNamedDeclaration(node) {
          if (node.source) context.report({ node, message: RE_EXPORT });
        },
      }),
    },
    'no-env-var-destructuring': {
      create: (context) => ({
        VariableDeclarator(node) {
          if (node.id.type === 'ObjectPattern' && isProcessEnv(node.init))
            context.report({ node, message: 'Read each EXPO_PUBLIC_ value as process.env.NAME; Metro inlines only that form.' });
        },
      }),
    },
    'no-dynamic-env-var': {
      create: (context) => ({
        MemberExpression(node) {
          if (isProcessEnv(node.object) && node.computed && node.property.type !== 'Literal')
            context.report({ node, message: 'Read each EXPO_PUBLIC_ value as process.env.NAME; Metro inlines only that form.' });
        },
      }),
    },
  },
};

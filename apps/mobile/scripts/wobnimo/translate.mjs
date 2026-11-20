// Explicit GLSL ES 3 -> SkSL rules for the SHA-pinned wobnimo 0.2.0 compiler.
export function translate(fragment) {
    let source = fragment;
    function once(from, to) {
        if (source.split(from).length !== 2) throw new Error(`Expected exactly one: ${from}`);
        source = source.replace(from, to);
    }
    // Runtime effects provide their own entry point and output, with top-left coordinates.
    once('#version 300 es', '');
    once('precision highp float;', '');
    once('precision highp int;', '');
    once('out vec4 fragColor;', '');
    once('void main() {', 'half4 main(float2 fragCoord) {');
    once('gl_FragCoord.xy', 'vec2(fragCoord.x, uResolution.y - fragCoord.y)');
    once('fragColor = over(front, over(body, over(back, floorLayer)));',
        'return over(front, over(body, over(back, floorLayer)));');
    // The WebGL workaround prevents driver unrolling; SkSL needs constant loop starts.
    once('#define ZERO (min(int(uTime), 0))', '');
    source = source.replace(/\bZERO\b/g, '0');
    // SkSL has no preprocessor; expression tags are literal constants.
    source = source.replace(/^#define (E_\w+) ([\d.]+)$/gm, 'const float $1 = $2;');
    // Uniform loop bounds are forbidden in ES2-strict runtime effects. Preserve early exit.
    const fxSize = Number(source.match(/uniform vec4 uFxA\[(\d+)\];/)?.[1]);
    if (!fxSize) throw new Error('Missing FX capacity');
    // CanvasKit's makeShader uploads float bits; native Skia additionally converts
    // integer uniforms. Count is exactly representable (0..32) on both as a float.
    once('uniform int uFxCount;', 'uniform float uFxCount;');
    once('for (int i = 0; i < uFxCount; i++) {',
        `for (int i = 0; i < ${fxSize}; i++) {\n    if (float(i) >= uFxCount) break;`);
    // ES2 has no integer bit operations; the four tetrahedron directions are identical.
    once('vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1))',
        'vec3(i == 0 || i == 3 ? 1.0 : 0.0, i >= 2 ? 1.0 : 0.0, i == 1 || i == 3 ? 1.0 : 0.0)');
    // The LED zigzag only uses nonnegative i in [0, 3].
    source = source.replaceAll('i % 2 == 0', '(i == 0 || i == 2)');
    if (/#|\b(gl_\w+|fragColor|precision|ZERO)\b|>>|<<|%/.test(source)) throw new Error('Untranslated GLSL construct');
    const uniforms = [...source.matchAll(/uniform (float|int|vec[234]|mat[234]) (\w+)(?:\[(\d+)\])?;/g)]
        .map(([, type, name, count]) => {
            const dimension = Number(type.at(-1)) || 1;
            return { name, size: dimension * (type.startsWith('mat') ? dimension : 1) * Number(count || 1), integer: type === 'int' };
        });
    if (uniforms.length !== 21) throw new Error('Uniform contract changed');
    return { source, uniforms };
}

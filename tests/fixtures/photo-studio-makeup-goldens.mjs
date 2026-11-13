// Stored 3x3 RGB crops, analytically calculated from the synthetic fixture.
// Independent of renderer and CPU implementation; tolerance 2/255, alpha tested separately.
// Gloss crop (127,196): fully covered lower lip, g >= .835 even allowing one RGB8 step.
// Highlight contribution is < .01/255 here; round(.6 * base * rose + .4 * rose) = (121,35,51).
// The separate bright-highlight assertion exercises the specular peak without assuming flat rasterization.
export const MAKEUP_GOLDENS = [
    {"name":"lashes-multiply","x":83,"y":81,"makeup":{"lashes":{"strength":1,"volume":1}},"rgb":[17,11,10,17,11,10,17,11,10,17,11,10,17,11,10,17,11,10,17,11,10,17,11,10,17,11,10]},
    {"name":"foundation-soft-light","x":127,"y":127,"makeup":{"foundation":{"strength":1}},"rgb":[171,125,79,171,125,79,171,125,79,171,125,79,171,125,79,171,125,79,171,125,79,171,125,79,171,125,79]},
    {"name":"blush-soft-light","x":78,"y":139,"makeup":{"blush":{"strength":1}},"rgb":[145,65,52,145,65,52,145,65,52,145,66,52,145,66,52,145,66,52,144,67,53,144,67,52,144,67,53]},
    {"name":"shadow-gradient","x":83,"y":79,"makeup":{"eyeshadow":{"strength":1}},"rgb":[97,62,36,97,62,36,97,62,36,95,60,36,95,60,36,95,60,36,92,58,35,92,58,35,92,58,35]},
    {"name":"brow-multiply","x":83,"y":59,"makeup":{"brows":{"strength":1}},"rgb":[41,21,11,41,21,11,41,21,11,41,21,11,41,21,11,41,21,11,41,21,11,41,21,11,41,21,11]},
    {"name":"liner-multiply","x":83,"y":83,"makeup":{"eyeliner":{"strength":1}},"rgb":[17,11,10,17,11,10,17,11,10,17,11,10,17,11,10,17,11,10,17,11,10,17,11,10,17,11,10]},
    {"name":"lip-matte","x":127,"y":196,"makeup":{"lips":{"strength":1,"finish":"matte"}},"rgb":[143,44,68,143,44,68,143,44,68,143,44,68,143,44,68,143,44,68,143,44,68,143,44,68,143,44,68]},
    {"name":"lip-tint","x":127,"y":196,"makeup":{"lips":{"strength":1,"finish":"tint"}},"rgb":[147,62,51,147,62,51,147,62,51,147,62,51,147,62,51,147,62,51,147,62,51,147,62,51,147,62,51]},
    {"name":"lip-gloss","x":127,"y":196,"makeup":{"lips":{"strength":1,"finish":"gloss"}},"rgb":[121,35,51,121,35,51,121,35,51,121,35,51,121,35,51,121,35,51,121,35,51,121,35,51,121,35,51]},
    {"name":"teeth-hole","x":127,"y":182,"makeup":{"foundation":{"strength":1},"lips":{"strength":1},"eyeshadow":{"strength":1}},"rgb":[128,96,64,128,96,64,128,96,64,128,96,64,128,96,64,128,96,64,128,96,64,128,96,64,128,96,64]},
    {"name":"eye-hole","x":83,"y":95,"makeup":{"foundation":{"strength":1},"lips":{"strength":1},"eyeshadow":{"strength":1}},"rgb":[128,96,64,128,96,64,128,96,64,128,96,64,128,96,64,128,96,64,128,96,64,128,96,64,128,96,64]},
    {"name":"top-left-orientation","x":3,"y":3,"makeup":{"foundation":{"strength":1},"lips":{"strength":1},"eyeshadow":{"strength":1}},"rgb":[20,40,80,20,40,80,20,40,80,20,40,80,20,40,80,20,40,80,20,40,80,20,40,80,20,40,80]},
    {"name":"bottom-right-orientation","x":245,"y":245,"makeup":{"foundation":{"strength":1},"lips":{"strength":1},"eyeshadow":{"strength":1}},"rgb":[180,160,140,180,160,140,180,160,140,180,160,140,180,160,140,180,160,140,180,160,140,180,160,140,180,160,140]},
];

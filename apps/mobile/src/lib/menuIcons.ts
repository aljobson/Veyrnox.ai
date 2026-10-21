// The menu's icons: Phosphor (regular), rendered to white PNGs in assets/icons and tinted by the image component, so no
// icon package or native module is needed. See assets/icons/README.md for the source and licence.
export const MENU_ICONS = {
    house: require('../../assets/icons/house.png'),
    chat: require('../../assets/icons/chat-circle.png'),
    sparkle: require('../../assets/icons/sparkle.png'),
    image: require('../../assets/icons/image.png'),
    film: require('../../assets/icons/film-strip.png'),
    user: require('../../assets/icons/user.png'),
    send: require('../../assets/icons/paper-plane-tilt.png'),
    play: require('../../assets/icons/play-circle.png'),
    folder: require('../../assets/icons/folder.png'),
    palette: require('../../assets/icons/palette.png'),
    coins: require('../../assets/icons/coins.png'),
    squares: require('../../assets/icons/squares-four.png'),
    cube: require('../../assets/icons/cube.png'),
    slate: require('../../assets/icons/film-slate.png'),
    help: require('../../assets/icons/question.png'),
    caretRight: require('../../assets/icons/caret-right.png'),
    caretDown: require('../../assets/icons/caret-down.png'),
    close: require('../../assets/icons/x.png'),
    video: require('../../assets/icons/video-camera.png'),
    audio: require('../../assets/icons/music-notes.png'),
    wrench: require('../../assets/icons/wrench.png'),
    smiley: require('../../assets/icons/smiley.png'),
} as const;

export type MenuIcon = keyof typeof MENU_ICONS;

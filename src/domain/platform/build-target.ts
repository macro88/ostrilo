/**
 * Whether this build targets a Chromium browser.
 *
 * Biometric unlock exists only there. It is compiled out of other targets
 * rather than disabled in them: a control that cannot do anything is a promise
 * the surface cannot keep. An unrecognised or absent target reads as not
 * Chromium, so the feature is never present by accident.
 *
 * Written as literal comparisons so the bundler can fold the constant and drop
 * the code behind it from a build that does not carry the feature.
 */
export const IS_CHROMIUM_BUILD =
  import.meta.env.BROWSER === "chrome" ||
  import.meta.env.BROWSER === "edge" ||
  import.meta.env.BROWSER === "opera";

/* eslint-disable import/order */
const { copySync, removeSync } = require('fs-extra');
const merge = require('lodash/merge');
const { join } = require('path');
const semver = require('semver');
const { ESBuildPlugin } = require('esbuild-loader');

const navigation = require('./constants/navigation-data');
const versions = require('./constants/versions');
const { version, betaVersion } = require('./package.json');

// To generate a sitemap, we need context about the supported versions and navigational data
const createSitemap = require('./scripts/create-sitemap');

// copy versions/v(latest version) to versions/latest
// (Next.js only half-handles symlinks)
const vLatest = join('pages', 'versions', `v${version}/`);
const latest = join('pages', 'versions', 'latest/');
removeSync(latest);
copySync(vLatest, latest);

const ESBUILD_USE = true;
const ESBUILD_LOADER = {
  loader: 'esbuild-loader',
  options: {
    loader: 'tsx',
    target: 'es2017',
  },
};

module.exports = {
  trailingSlash: true,
  // Rather than use `@zeit/next-mdx`, we replicate it
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdx'],
  webpack: (config, options) => {
    // Add preval support for `constants/*` only and move it to the `.next/preval` cache.
    // It's to prevent over-usage and separate the cache to allow manually invalidation.
    // See: https://github.com/kentcdodds/babel-plugin-preval/issues/19\
    config.module.rules.push({
      test: /.jsx?$/,
      include: [join(__dirname, 'constants')],
      use: merge({}, options.defaultLoaders.babel, {
        options: {
          // Keep this path in sync with package.json and other scripts that clear the cache
          cacheDirectory: '.next/preval',
          plugins: ['preval'],
        },
      }),
    });
    // Add support for MDX with our custom loader
    config.module.rules.push({
      test: /.mdx?$/, // load both .md and .mdx files
      use: [
        ESBUILD_USE ? ESBUILD_LOADER : options.defaultLoaders.babel,
        {
          loader: '@mdx-js/loader',
          options: {
            remarkPlugins: [
              require('./mdx-plugins/remark-heading-meta'),
              require('./mdx-plugins/remark-link-rewrite'),
            ],
          },
        },
        join(__dirname, './common/md-loader'),
      ],
    });
    // Fix inline or browser MDX usage: https://mdxjs.com/getting-started/webpack#running-mdx-in-the-browser
    config.node = { fs: 'empty' };

    // ESBUILD
    if (ESBUILD_USE) {
      // const rule = config.module.rules[0];
      // if (rule) {
      //   const convertToESBuild = loader => {
      //     if (loader.loader === 'next-babel-loader') {
      //       return ESBUILD_LOADER;
      //     }
      //     return loader;
      //   };

      //   if (Array.isArray(rule.use)) {
      //     rule.use = rule.use.map(loader => {
      //       if (typeof e === 'object') {
      //         return convertToESBuild(loader);
      //       }
      //       return loader;
      //     });
      //   } else {
      //     rule.use = convertToESBuild(rule.use);
      //   }
      // }
      config.plugins.push(new options.webpack.ProvidePlugin({ React: 'react' }));
      config.plugins.push(new ESBuildPlugin());
    }

    return config;
  },
  // Create a map of all pages to export
  async exportPathMap(defaultPathMap, { dev, outDir }) {
    if (dev) {
      return defaultPathMap;
    }
    const pathMap = Object.assign(
      ...Object.entries(defaultPathMap).map(([pathname, page]) => {
        if (pathname.match(/\/v[1-9][^/]*$/)) {
          // ends in "/v<version>"
          pathname += '/index.html'; // TODO: find out why we need to do this
        }
        if (pathname.match(/unversioned/)) {
          return {};
        } else {
          // hide versions greater than the package.json version number
          const versionMatch = pathname.match(/\/v(\d\d\.\d\.\d)\//);
          if (
            versionMatch &&
            versionMatch[1] &&
            semver.gt(versionMatch[1], betaVersion || version)
          ) {
            return {};
          }
          return { [pathname]: page };
        }
      })
    );
    // Create a sitemap for crawlers like Google and Algolia
    createSitemap({
      pathMap,
      domain: 'https://docs.expo.io',
      output: join(outDir, 'sitemap.xml'),
      // Some of the search engines only track the first N items from the sitemap,
      // this makes sure our starting and general guides are first, and API index last (in order from new to old)
      pathsPriority: [
        ...navigation.startingDirectories,
        ...navigation.generalDirectories,
        ...versions.VERSIONS.map(version => `versions/${version}`),
      ],
      // Some of our pages are "hidden" and should not be added to the sitemap
      pathsHidden: navigation.previewDirectories,
    });
    return pathMap;
  },
};

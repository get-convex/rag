# Developing guide

## Running locally

```sh
npm i
npm run setup
npm run dev
```

## Testing

```sh
npm run clean
npm run build
npm run typecheck
npm run lint
npm run test
```

## Deploying

### Building a one-off package

```sh
npm run clean
npm run build
npm pack
```

### Deploying a new version

```sh
npm run release
```

#### Alpha release

The same as above, but it will publish the release with the `@alpha` tag:

```sh
npm run alpha
```

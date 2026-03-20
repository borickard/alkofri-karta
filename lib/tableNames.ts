export function getTableNames(demo: boolean) {
    return {
        bars: demo ? 'bars_demo' : 'bars',
        prices: demo ? 'prices_demo' : 'prices',
    };
}
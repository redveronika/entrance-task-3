'use strict';
/**
 * @file
 * Сервис-воркер, обеспечивающий оффлайновую работу избранного
 */

const CACHE_VERSION = '1.0.0';
const FILES_TO_CASH = [
    'gifs.html',
    'assets/star.svg',
    'assets/blocks.js',
    'assets/templates.js',
    'assets/style.css',
    'vendor/bem-components-dist-5.0.0/touch-phone/bem-components.dev.css',
    'vendor/bem-components-dist-5.0.0/touch-phone/bem-components.dev.js',
    'vendor/kv-keeper.js-1.0.4/kv-keeper.js',
    'vendor/kv-keeper.js-1.0.4/kv-keeper.typedef.js',
];

importScripts('vendor/kv-keeper.js-1.0.4/kv-keeper.js');

self.addEventListener('install', event => {
    // Вопрос №1: зачем нужен этот вызов?
    // Ответ: позволяет обновить Service Worker новой версии без ожидания деактивации Service Worker предыдущей версии, говорим, что ждать не нужно
    self.skipWaiting();
    event.waitUntil(
        preCacheAppShell().then(() => {
            preCacheAllFavorites().then(() => {
                console.log('[ServiceWorker] Installed!');
            });
        })
    )
});

self.addEventListener('activate', event => {
    const promise = deleteObsoleteCaches()
        .then(() => {
            // Вопрос №2: зачем нужен этот вызов?
            // Ответ: говорим Service Worker новой версии перехватить управление даже открытых, уже работающих вкладок нашего приложения
            self.clients.claim();
            console.log('[ServiceWorker] Activated!');
        });
    event.waitUntil(promise);
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Вопрос №3: для всех ли случаев подойдёт такое построение ключа?
    // Ответ: такое построение ключа не подойдет при запросе с GET параметрами
    const cacheKey = url.origin + url.pathname;

    let response;
    if (needStoreForOffline(cacheKey)) {
        response = fetchAndPutToCache(cacheKey, event.request);
    } else {
        response = fetchWithFallbackToCache(event.request);
    }
    event.respondWith(response);
});

self.addEventListener('message', event => {
    const promise = handleMessage(event.data);

    event.waitUntil(promise);
});

// Положить в новый кеш файлы оболочки приложения
function preCacheAppShell() {
    return caches.open(CACHE_VERSION)
        .then(cache => {
            return cache.addAll(FILES_TO_CASH);
        });
}

// Положить в новый кеш все добавленные в избранное картинки
function preCacheAllFavorites() {
    return getAllFavorites()
        .then(urls => Promise.all(
            urls.map(url => fetch(url)))
        )
        .then(responses => {
            return caches.open(CACHE_VERSION)
                .then(cache => {
                    return Promise.all(
                        responses.map(response => cache.put(response.url, response))
                    );
                });
        });
}


// Извлечь из БД добавленные в избранное картинки
function getAllFavorites() {
    return new Promise((resolve, reject) => {
        KvKeeper.getKeys((err, keys) => {
            if (err) {
                return reject(err);
            }

            const ids = keys
                .filter(key => key.startsWith('favorites:'))
                // 'favorites:'.length == 10
                .map(key => key.slice(10));

            Promise.all(ids.map(getFavoriteById))
                .then(urlGroups => {
                    return urlGroups.reduce((res, urls) => res.concat(urls), []);
                })
                .then(resolve, reject);
        });
    });
}

// Извлечь из БД запись о картинке
function getFavoriteById(id) {
    return new Promise((resolve, reject) => {
        KvKeeper.getItem('favorites:' + id, (err, val) => {
            if (err) {
                return reject(err);
            }

            const data = JSON.parse(val);
            const images = [data.fallback].concat(data.sources.map(item => item.url));

            resolve(images);
        });
    });
}

// Удалить неактуальный кеш
function deleteObsoleteCaches() {
    return caches.keys()
        .then(names => {
            // Вопрос №4: зачем нужна эта цепочка вызовов?
            // Для организации версионности кэша. Проверяем, если версия закэшированная файла не равна текущей, то удаляем его.
            return Promise.all(
                names.filter(name => name !== CACHE_VERSION)
                    .map(name => {
                        console.log('[ServiceWorker] Deleting obsolete cache:', name);
                        return caches.delete(name);
                    })
            );
        });
}

// Нужно ли при скачивании сохранять ресурс для оффлайна?
function needStoreForOffline(cacheKey) {
    return cacheKey.includes('gifs.html');
}

// Скачать и добавить в кеш
function fetchAndPutToCache(cacheKey, request) {
    return fetch(request)
        .then(response => {
            return caches.open(CACHE_VERSION)
                .then(cache => {
                    // Вопрос №5: для чего нужно клонирование?
                    // Из-за технических ограничений Fetch API мы не можем вернуть 2 ответа от одного запроса
                    cache.put(cacheKey, response.clone());
                })
                .then(() => response);
        })
        .catch(err => {
            console.error('[ServiceWorker] Fetch error:', err);
            return caches.match(cacheKey);
        });
}

// Попытаться скачать, при неудаче обратиться в кеш
function fetchWithFallbackToCache(request) {
    return fetch(request)
        .catch(() => {
            console.log('[ServiceWorker] Fallback to offline cache:', request.url);
            return caches.match(request.url);
        });
}

// Обработать сообщение от клиента
const messageHandlers = {
    'favorite:add': handleFavoriteAdd,
    'favorite:remove': handleFavoriteRemove
};

function handleMessage(eventData) {
    const message = eventData.message;
    const id = eventData.id;
    const data = eventData.data;

    console.log('[ServiceWorker] Got message:', message, 'for id:', id);

    const handler = messageHandlers[message];
    return Promise.resolve(handler && handler(id, data));
}

// Обработать сообщение о добавлении новой картинки в избранное
function handleFavoriteAdd(id, data) {
    return caches.open(CACHE_VERSION)
        .then(cache => {
            const urls = [].concat(
                data.fallback,
                (data.sources || []).map(item => item.url)
            );

            return Promise
                .all(urls.map(url => fetch(url)))
                .then(responses => {
                    return Promise.all(
                        responses.map(response => cache.put(response.url, response))
                    );
                });
        });
}

// Обработать сообщение об удалении картинки из избранного
function handleFavoriteRemove(id, data) {
    return caches.open(CACHE_VERSION)
        .then(cache => {
            const urls = [].concat(
                data.fallback,
                (data.sources || []).map(item => item.url)
            );

            return Promise
                .all(urls.map(url => fetch(url)))
                .then(responses => {
                    return Promise.all(
                        responses.map(response => cache.delete(response.url, response))
                    );
                });
        });
}

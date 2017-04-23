# Задание 3

Мобилизация.Гифки – сервис для поиска гифок в перерывах между занятиями.

Сервис написан с использованием [bem-components](https://ru.bem.info/platform/libs/bem-components/5.0.0/).

Работа избранного в оффлайне реализована с помощью технологии [Service Worker](https://developer.mozilla.org/ru/docs/Web/API/Service_Worker_API/Using_Service_Workers).

Для поиска изображений используется [API сервиса Giphy](https://github.com/Giphy/GiphyAPI).

В браузерах, не поддерживающих сервис-воркеры, приложение так же должно корректно работать, 
за исключением возможности работы в оффлайне.

## Структура проекта

  * `gifs.html` – точка входа
  * `assets` – статические файлы проекта
  * `vendor` –  статические файлы внешних библиотек
  * `service-worker.js` – скрипт сервис-воркера

Открывать `gifs.html` нужно с помощью локального веб-сервера – не как файл. 
Это можно сделать с помощью встроенного в WebStorm/Idea веб-сервера, с помощью простого сервера
из состава PHP или Python. Можно воспользоваться и любым другим способом.

# Решение

1. >Правда, ServiceWorker перестал обрабатывать запросы за ресурсами приложения: HTML-страницей, скриптами и стилями из каталогов vendor и assets.

Данный баг был поправлен путем переноса `service-worker.js` файла из директории assets в корневую директорию. Данный баг был связан с тем, что область видимости `Service Worker`а ограничена: он может перехватывать события js-файлов, лежащих в той же директории, что и он сам, либо файлов вложенных в данную директорию.

Так же были поправлены пути к `service-worker.js` при его регистрации в файле `block.js` и к библиотеке `kv-keeper.js` в файле `service-worker.js`.


2. >Был сделан фикс этого бага, но перестал работать офлайн-режим: основной документ не загружался при отсутствии сети.

При обработке `Service Worker`ом запросов, часть из них записывается в кэш. Функция `needStoreForOffline()` проверяет, требуется ли закэшировать данный ресурс. После добавления проверки ` cacheKey.includes('gifs.html');` в функцию `needStoreForOffline()` работа офлайн-режима была нормализована, основной документ `gifs.html` начал загружаться из кэша.


3. >... стало невозможно обновить HTML-страницу: у клиентов она стала браться из кеша не только в офлайн-режиме, а всегда.

Рассмотрим подробнее обработку запросов:

```
 let response;
    if (needStoreForOffline(cacheKey)) { 
    response = caches.match(cacheKey)     
      .then(cacheResponse => cacheResponse || fetchAndPutToCache(cacheKey, event.request));        
    } else {
        response = fetchWithFallbackToCache(event.request);
				}
    event.respondWith(response);
				
```
В случае, если функция `needStoreForOffline()` возвращает `true` - а значит данный ресур необходимо закэшировать - ресур ищется в кэше, при нахождении возвращается в `response`, в обратном случае берется из сети.

Поправим код выше, чтобы при наличии подключения к сети HTML-страница бралась из сети, а из кэша только в офлайн-режиме:

```
let response;
    if (needStoreForOffline(cacheKey)) {
        response = fetchAndPutToCache(cacheKey, event.request);
    } else {
        response = fetchWithFallbackToCache(event.request);
    }
    event.respondWith(response);
				
```

Функция `fetchAndPutToCache()` при отсутствии интернет-соединения вернет файл из кэша.

4. >Оказалось, что невозможно обновить статику из директорий vendor и assets. 

Для обновления статики необходимо изменить `CACHE_VERSION`. При активации `Service Worker`а функция `deleteObsoleteCaches()` выполнит проверку на версионность кэша и удалит файлы старой версии.


5. >Реализуйте возможность переключения в офлайн-режим после первого же запроса, а не после второго, как это происходило в работающем приложении до всех рефакторингов.

Для преключения в офлайн-режим после первогого запроса закэшируем необходимые файлы на этапе установки `Service Worker`а, для этого создадим функцию `preCacheAppShell()` и вызовем ее перед кэшированием фаворитов:

```
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

function preCacheAppShell() {
    return caches.open(CACHE_VERSION)
        .then(cache => {
            return cache.addAll(FILES_TO_CASH);
        });
}

```

Так же было замечено, что не реализован метод удаления ресурсов GIF-файла из кэша, при удалении записи из избранного, был добавлен: 

```
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

```

# Ответы на вопросы из файла `service-worker.js`

1. `Вопрос №1: зачем нужен этот вызов?`

Ответ: позволяет обновить `Service Worker` новой версии без ожидания деактивации `Service Worker` предыдущей версии, говорим, что ждать не нужно.

2. `Вопрос №2: зачем нужен этот вызов?`

Ответ: говорим `Service Worker` новой версии перехватить управление даже открытых, уже работающих вкладок нашего приложения.

3. `Вопрос №3: для всех ли случаев подойдёт такое построение ключа?`

Ответ: такое построение ключа не подойдет при запросе с `GET параметрами`

4. `Вопрос №4: зачем нужна эта цепочка вызовов?`

Для организации версионности кэша. Проверяем, если версия закэшированная файла не равна текущей, то удаляем его.

5. `Вопрос №5: для чего нужно клонирование?`

Из-за технических ограничений `Fetch API` мы не можем вернуть 2 ответа от одного запроса.


При знакомстве с `Service Worker API` очень полезным оказался [доклад Максима Сальникова на PWA DAYS](https://www.youtube.com/watch?v=SVX3yF2NIzo&index=2&list=PLfQcLh3eSYZ_tFcv_IypEsI8FnCIArSM5&t)

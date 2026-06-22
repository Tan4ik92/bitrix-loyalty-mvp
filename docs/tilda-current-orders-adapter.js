function getFilters(block_id) {
    const filters = {};
    const index = 'filter[' + block_id + ']';
    const params = new URLSearchParams(window.location.search);
    params.forEach(function(key, value, params) {
        if (value.indexOf(index) > -1) {
            filters[value] = params.get(value)
        }
    });
    return filters;
}
function transformToObject(text) {
  try {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;

    let jsonStr = textarea.value.replace(/'/g, '"');

    jsonStr = jsonStr
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");

    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Ошибка при парсинге JSON:', e);
    return null;
  }
}

(function () {
const fixedFields=transformToObject('{}');
if(fixedFields?.emptyBlockId){
    const style = document.createElement("style");
    style.id=fixedFields?.emptyBlockId+'style';
    style.innerHTML = `
        ${fixedFields.emptyBlockId} {
           display:none;
        }
    `;
    document.head.appendChild(style);
}

function t_ready(e) {
    "loading" != document.readyState ? e() : document.addEventListener ? document.addEventListener("DOMContentLoaded", e) : document.attachEvent("onreadystatechange", (function() {
        "loading" != document.readyState && e()
    }
    ))
}

function translateLoadMore(lang) {
    const translations = {
        EN: 'Load more',
        RU: 'Загрузить ещё',
        FR: 'Charger plus',
        DE: 'Mehr laden',
        ES: 'Carga más',
        PT: 'Carregue mais',
        UK: 'Завантажити ще',
        JA: 'もっと読み込む',
        ZH: '裝載更多',
    };
    if (lang && translations[lang]) {
        return translations[lang];
    } else {
        return translations.EN;
    }
}

t_ready(function () {

    const tool_id = 'ee530320-5f54-4c74-a5a4-584d3979c448';
    const block_id = '#rec1711201401'.substring(4);
    const blockSelector = `#rec1711201401`;
    const block_template = document.querySelector(blockSelector);
    block_template.classList.remove('r_hidden');
    block_template.querySelectorAll('script').forEach(script => script.remove());

    const wrapper = document.createElement('div');
    wrapper.id = `adapter_rec${block_id}`;
    wrapper.className = 'r';
    block_template.parentNode.insertBefore(wrapper, block_template.nextSibling);
    wrapper.appendChild(block_template);
    block_template.classList.remove('r');

    const container = document.getElementById(`rec${block_id}`);

    const adapter_wrapper = document.getElementById(`adapter_rec${block_id}`);

    const tableWrapper = document.querySelector(blockSelector + ' .t431__table-wrapper');
    const btnWrapper = document.createElement('div');
    btnWrapper.className = 't431__btnwrapper adapter_loadmore';
    btnWrapper.style.width = '100%';
    btnWrapper.style.textAlign = 'center';
    btnWrapper.style.marginTop = '40px';

    const link = document.createElement('a');
    link.className = 't-btn t-btn_sm';

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.height = '100%';

    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');
    const td = document.createElement('td');

    tr.appendChild(td);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    link.appendChild(table);
    btnWrapper.appendChild(link);
    tableWrapper.appendChild(btnWrapper);

// Получаем необходимые данные
    const tools_runner = 'https://d5dde9aqsr3q4a679jrq.apigw.yandexcloud.net/api/user-integrations/load-records';
    const project_id = document.getElementById('allrecords').getAttribute('data-tilda-project-id');

    const profile = JSON.parse(localStorage.getItem(`tilda_members_profile${project_id}`) ||
        localStorage.getItem('memberarea_profile') ||
        '{"login":"test@test.com"}');


    // Удаляем группы и курсы из профиля
    ['groups', 'courses'].forEach(key => delete profile[key]);

    let block;
    let load_more;
    let filters;
    let totalRecordsCount = 0;

async function loadMore(event) {
    try {
        if (load_more) {
            // Отключаем кнопку кликов
            load_more.style.pointerEvents = 'none';
            load_more.querySelector('td').textContent = '...';
            load_more.removeEventListener('click', loadMore);
        }

        const offset = event.data.offset;

        const data = await fetchData(offset);
        if ('error' in data) {
            showError('adapter error (#rec1711201401): ' + data.error);
            return;
        }

        totalRecordsCount += data.records.length;

        if (data.records.length === 0&&fixedFields?.emptyBlockId) {
            showEmptyBlock();
            return;
        }

        renderData(data, offset);

        // Проверяем, есть ли ещё данные
        try {
            const nextData = await fetchData(totalRecordsCount);
            if (Array.isArray(nextData.records) && nextData.records.length > 0) {
                updateLoadMoreButton();
            } else {
                if (load_more) load_more.remove();
            }
        } catch (checkError) {
            console.warn('Ошибка при проверке следующей порции данных:', checkError);
            if (load_more) load_more.remove();
        }

        window.dispatchEvent(new Event('resize'));
        block.dispatchEvent(new Event('adapter_loaded'));

    } catch (error) {
        console.error('Ошибка в loadMore:', error);
        showError('adapter error (#rec1711201401): ' + (error.message || 'Unknown error'));
    } finally {
        // Возвращаем pointer events, если кнопка ещё существует
        if (load_more) {
            load_more.style.pointerEvents = '';
        }
    }
}



async function fetchData(offset) {
    const response = await fetch(tools_runner, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            tool_id,
            profile,
            project_id: project_id || null,
            referer: document.location.origin,
            user_agent: navigator.userAgent,
            filters,
            offset
        })
    });

    return response.json();
}

function renderData(data, offset) {
    let text = '';
    data.records.forEach(record => {
        if ('table_content' in record) {
            text += record.table_content + '\n';
        }
    });

    block.querySelector('.t431__data-part2').textContent = text;

    if (offset) {
        block.querySelector('.t431__data-part1').textContent = '';
    } else {
        block.querySelector('.t431__table').innerHTML = '';
    }

    t431_init(block_id);
}

function showError(message) {
    block.textContent = message;
    block.style.textAlign = 'center';
    block.style.display = 'block';
}

function showEmptyBlock() {
    const emptyBlock = document.getElementById(fixedFields.emptyBlockId.substr(1));
    if (emptyBlock) {
        document.querySelectorAll(blockSelector).forEach(el=>el.style.display='none');
        adapter_wrapper.appendChild(emptyBlock);
        emptyBlock.style.display = 'block';
    }
}
let load_more_initialized = false;

function updateLoadMoreButton() {
    if (!load_more_initialized) {
        load_more.querySelector('td').textContent = translateLoadMore(window.tildaBrowserLang);
        load_more.addEventListener('click', () => {
            loadMore({ data: { offset: totalRecordsCount } });
        });
        load_more_initialized = true;
    } else {
        load_more.querySelector('td').textContent = translateLoadMore(window.tildaBrowserLang);
    }
}



    // Создаем функцию для инициализации adapter
    function initadapter() {
        // Клонируем шаблон блока
            block = block_template.cloneNode(true);

        // Очищаем содержимое adapter_wrapper
        adapter_wrapper.innerHTML = '';

        // Добавляем новый блок в adapter_wrapper
        adapter_wrapper.appendChild(block);

        // Очищаем таблицу внутри блока
        const table = block.querySelector('.t431__table');
        if (table) {
            table.innerHTML = '';
        }

        // Получаем элемент "Загрузить еще"
        load_more = block.querySelector('#rec1711201401 .adapter_loadmore');

        // Получаем фильтры
        filters = getFilters(block_id);
        console.log('filters', filters);

        // Загружаем данные
        loadMore({data: {offset: null}});
    }


// Запускаем инициализацию
    initadapter();

})


})();
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


t_ready(function () {
        const tool_id = '4c17994d-f6f6-4dd3-a9a2-09d06e0b2f64';
        const block_id = '#rec1711201371'.substring(4);
        const blockSelector = '#rec1711201371';
        const block = document.querySelector(blockSelector);
        block.classList.remove('r_hidden');

        
    
        const textElements = block.querySelectorAll('.t-text');
        textElements.forEach(text => {
            text.style.whiteSpace = 'pre-wrap';
        });
    
        const wrapper = document.createElement('div');
        wrapper.id = `rec${block_id}`;
        wrapper.classList.add('r');
        block.parentNode.insertBefore(wrapper, block);
        wrapper.appendChild(block);
        block.classList.remove('r');
        block.remove();
        const container = document.getElementById(`rec${block_id}`);
    
        const showdown_url = 'https://cdnjs.cloudflare.com/ajax/libs/showdown/1.9.1/showdown.min.js';
        const tools_runner = 'https://d5dde9aqsr3q4a679jrq.apigw.yandexcloud.net/api/user-integrations/load-records';
        const project_id = document.querySelector('#allrecords').getAttribute('data-tilda-project-id');
    
        const profile = JSON.parse(localStorage.getItem(`tilda_members_profile${project_id}`) ||
                                     localStorage.getItem('memberarea_profile') ||
                                     '{"login": "test@test.com"}');
    
    
        ['groups', 'courses'].forEach(key => delete profile[key]);
    
        const filters = getFilters(block_id);
        console.log('filters', filters);
    
        fetch(tools_runner, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                tool_id: tool_id,
                profile: profile,
                project_id: project_id || null,
                referer: document.location.origin,
                user_agent: navigator.userAgent,
                filters: filters,
            }),
        })
        .then(response => response.json())
        .then(data => {
            if ('error' in data) {
                container.innerHTML = `<div>adapter error (##rec1711201371): ${data.error}</div>`;
                container.style.textAlign = 'center';
                return;
            }
    
            const script = document.createElement('script');
            script.src = showdown_url;
            script.onload = function() {
                const converter = new showdown.Converter();

                if(data?.records?.length===0&&fixedFields?.emptyBlockId){
                    const emptyBlock=document.getElementById(fixedFields.emptyBlockId.substr(1))
                    if(emptyBlock){
                        container.appendChild(emptyBlock);
                        emptyBlock.style.display='block';
                    }
                }
                data.records.forEach(function (record, index) {
                    const item = block.cloneNode(true);
                    item.id = `rec${block_id}_${index}`;
    
                    if ('text' in record) {
                        const text = item.querySelector('.t-text');
                        text.innerHTML = converter.makeHtml(String(record.text));
                        text.querySelectorAll('blockquote').forEach(quote => {
                            quote.style.whiteSpace = 'normal';
                            quote.style.borderLeft = '3px solid #333333';
                            quote.style.paddingLeft = '20px';
                        });
                    }
    
                    container.appendChild(item);
                    window.dispatchEvent(new Event('resize'));
                });
                const event = new Event('adapter_loaded');
                container.dispatchEvent(event);
            };
            document.body.appendChild(script);
        })
        .catch(error => {
            console.error('Error:', error);
            if (error.response) {
                error.response.json().then(data => {
                    if ('error' in data) { container.innerHTML = `<div>adapter error (#rec1711201371): ${data.error}</div>`;
                    container.style.textAlign = 'center';
                }
            });
        }
    });
    });
})();
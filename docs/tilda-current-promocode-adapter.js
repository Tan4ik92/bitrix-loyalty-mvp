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
    const tool_id = 'c0903e9b-10f2-451f-a3d5-6f2b0ae3964e';
    const block_id = '#rec1711201421'.substring(4);
    const blockSelector = `#rec1711201421`;
    const block = document.querySelector(blockSelector);
    block.classList.remove('r_hidden');

    const wrapper = document.createElement('div');
    wrapper.id = `rec${block_id}`;
    wrapper.className = 'r';
    block.parentNode.insertBefore(wrapper, block.nextSibling);
    wrapper.appendChild(block);
    block.classList.remove('r');
    block.remove();
    const container = document.getElementById(`rec${block_id}`);

    const tools_runner = 'https://d5dde9aqsr3q4a679jrq.apigw.yandexcloud.net/api/user-integrations/load-records';
    const project_id = document.getElementById('allrecords').getAttribute('data-tilda-project-id');

    const profile = JSON.parse(localStorage.getItem(`tilda_members_profile${project_id}`) ||
        localStorage.getItem('memberarea_profile') ||
        '{"login":"test@test.com"}');


    // Удаляем группы и курсы из профиля
    ['groups', 'courses'].forEach(key => delete profile[key]);

    const filters = getFilters(block_id);
    const data = {
        tool_id: tool_id,
        profile: profile,
        project_id: project_id || null,
        referer: document.location.origin,
        user_agent: navigator.userAgent,
        filters: filters,
    };

    fetch(tools_runner, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify(data),
    })
        .then(response => {
            if (!response.ok) {
                return response.json().then(errorData => {
                    throw new Error(errorData.error || 'Unknown error');
                });
            }
            return response.json();
        })
        .then(responseData => {
            if ('error' in responseData) {
                container.textContent = 'adapter error (#rec1711201421): ' + responseData.error;
                container.style.textAlign = 'center';
                return;
            }

             if(responseData?.records?.length===0&&fixedFields?.emptyBlockId){
                const emptyBlock=document.getElementById(fixedFields.emptyBlockId.substr(1))
                if(emptyBlock){
                    container.appendChild(emptyBlock);
                    emptyBlock.style.display='block';
                }
             }

            responseData.records.forEach((record, index) => {
                const item = block.cloneNode(true);
                item.id = `rec${block_id}_${index}`;
                if ('html' in record) {
                    item.querySelector('.t123 > div > div').innerHTML = record.html;
                    const scripts = item.querySelectorAll('script');

                    scripts.forEach((script) => {
                        const newScript = document.createElement('script');
                        for (const attr of script.attributes) {
                            newScript.setAttribute(attr.name, attr.value);
                        }

                        newScript.textContent = script.textContent;

                        script.parentNode.replaceChild(newScript, script);
                    });
                }
                container.appendChild(item);
                window.dispatchEvent(new Event('resize'));
            });

            container.dispatchEvent(new Event('adapter_loaded'));
        })
        .catch(error => {
            container.outerHTML = '<div>adapter error (#rec1711201421): ' + error.message + '</div>';
            container.style.textAlign = 'center';
        });

})

})();
// ==UserScript==
// @name         WISDOM Timetable
// @namespace    https://github.com/AJ-cubes/WISDOM-Timetable
// @version      2025.4.0
// @description  Alt+T shows current/next lessons. Alt+P shows tomorrow's books, PE status, and birthdays.
// @author       AJ-cubes
// @match        *://*/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://github.com/AJ-cubes/WISDOM-Timetable/raw/main/WISDOM-Timetable.meta.js
// @downloadURL  https://github.com/AJ-cubes/WISDOM-Timetable/raw/main/WISDOM-Timetable.user.js
// ==/UserScript==

(function() {
    'use strict';

    const dictionary = {
        "DT": "Design Technology",
        "SC": "Science",
        "PE": "Physical Education",
        "EN": "English",
        "CX": "Chinese",
        "IS": "I&S",
        "MA": "Mathematics",
        "SP": "Spanish",
        "TP": "Tutor Period",
        "FR": "French",
        "EX": "EAP",
        "CQ": "Chinese Mastery"
    };

    const CA_DICT = {
        "D6": "Visual Arts",
        "D4": "Drama",
        "B4": "Music"
    };

    const SKIPPED_PERIODS_BY_DOW = {
        1: [['ttprd4'], 3]
    };

    const periodTimes = [
        { label: 'Period 1', start: '08:30', end: '09:35', class: 'ttprd1', i: 0 },
        { label: 'Period 2', start: '09:40', end: '10:45', class: 'ttprd2', i: 1 },
        { label: 'Period 3', start: '11:05', end: '12:10', class: 'ttprd3', i: 2 },
        { label: 'Period 4', start: '12:15', end: '13:20', class: 'ttprd4', i: 3 },
        { label: 'Period 5', start: '14:05', end: '15:10', class: 'ttprd5', i: 4 }
    ];

    const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const nowMins = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
    const getSkippedSetForDow = dow => new Set(SKIPPED_PERIODS_BY_DOW[dow] ? SKIPPED_PERIODS_BY_DOW[dow][0] : []);
    const getSkippedPeriodForDow = dow => SKIPPED_PERIODS_BY_DOW[dow] ? SKIPPED_PERIODS_BY_DOW[dow][1] : -1;

    const topDoc = window.top.document;

    function parseCell(cell) {
        if (!cell) return { code: '', room: '' };
        const a = cell.querySelector('a');
        const code = (a && a.textContent && a.textContent.trim()) || '';
        const raw = cell.innerText.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
        const m = raw.match(/\bin\s+([A-Za-z0-9\/\-]+)\b/i);
        const room = m ? m[1] : '';
        return { code, room };
    }

    function getDisplayName(code, room) {
        if (dictionary[code.replace(/[^a-zA-Z]/g, '').toUpperCase()]) return dictionary[code.replace(/[^a-zA-Z]/g, '').toUpperCase()];
        if (CA_DICT[room.slice(0, 2)]) return CA_DICT[room.slice(0, 2)];
        return code;
    }

    function buildOverlay(lines, index = lines.length - 1, lineClickEvent = () => {}) {
        const style = document.createElement('style');
        style.textContent = `
            .emoji {
                animation: emoji 1.2s infinite alternate;
                margin: 0 14px 0 0;
                font-size: 0.75em;
                filter: drop-shadow(0 0 6px #fff8);
            }

            @keyframes emoji {
                0% { opacity: 0.7; transform: scale(1) rotate(-10deg);}
                100% { opacity: 1; transform: scale(1.18) rotate(10deg);}
            }

            @keyframes pop {
                0% { transform: scale(0.7) translateY(-40px); opacity: 0; }
                75% { transform: scale(1.08) translateY(6px); opacity: 1; }
                100% { transform: scale(1) translateY(0); opacity: 1; }
            }

            div:has(> span.cross) {
                position: relative;
            }

            div:has(> span.cross)::before,
            div:has(> span.cross)::after {
                content: '';
                position: absolute;
                inset: 0;
                background: url("https://raw.githubusercontent.com/AJ-cubes/SpeedTube/refs/heads/main/code/src/images/background.png") center/cover;
                background-blend-mode: multiply;
                box-shadow: 6px 7px 7px -2px #00000073;
                z-index: 10;
                opacity: 0.75;
            }

            div:has(> span.cross)::before {
                clip-path: polygon(
                    0% 100%,
                    0% calc(100% - calc(1em / 3)),
                    calc(100% - calc(1em / 3)) 0%,
                    100% 0%,
                    100% calc(1em / 3),
                    calc(1em / 3) 100%
                );
            }

            div:has(> span.cross)::after {
                clip-path: polygon(
                    100% 100%,
                    100% calc(100% - calc(1em / 3)),
                    calc(1em / 3) 0%,
                    0% 0%,
                    0% calc(1em / 3),
                    calc(100% - calc(1em / 3)) 100%
                );
            }
        `;
        topDoc.head.appendChild(style);

        if (topDoc.getElementById('timetable-overlay')) topDoc.getElementById('timetable-overlay').remove();

        const prevOverflow = topDoc.body.style.overflow;
        topDoc.body.style.overflow = 'hidden';

        const overlay = topDoc.createElement('div');
        overlay.id = 'timetable-overlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            background: 'rgba(0,0,0,0.9)',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '30px',
            boxSizing: 'border-box',
            fontFamily: 'system-ui, sans-serif',
            animation: 'pop 0.7s cubic-bezier(.68,-0.55,.27,1.55)',
            zIndex: '999999',
        });

        const closeBtn = topDoc.createElement('div');
        closeBtn.innerHTML = '<span class="emoji">✖</span>';
        Object.assign(closeBtn.style, {
            position: 'absolute',
            top: '20px',
            right: '20px',
            fontSize: '3.5rem',
            cursor: 'pointer',
            color: '#fff',
            borderRadius: '50%',
            width: '60px',
            height: '60px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'pop 0.7s cubic-bezier(.68,-0.55,.27,1.55)',
        });

        const close = () => {
            overlay.remove();
            topDoc.body.style.overflow = prevOverflow;
        };

        closeBtn.addEventListener('click', close);
        topDoc.addEventListener('keydown', e => {
            if (e.key === 'Escape') close();
        }, { once: true });

        overlay.appendChild(closeBtn);

        lines.forEach((txt, i) => {
            const line = topDoc.createElement('div');
            line.classList.add('line');
            line.innerHTML = txt;
            Object.assign(line.style, {
                fontWeight: 'bold',
                fontSize: '3rem',
                margin: '0.3125em',
                padding: '0.344em 0.563em',
                background: 'rgba(255,0,0,0.28)',
                border: '4px solid red',
                borderRadius: '12px',
                whiteSpace: 'normal',
                maxWidth: '90vw',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                verticalAlign: 'middle',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                animation: 'pop 0.7s cubic-bezier(.68,-0.55,.27,1.55)'
            });
            line.addEventListener('click', () => { lineClickEvent(i, line); });

            if (i === index) {
                line.style.boxShadow = `
                    0 0 12px 4px rgba(0,255,0,0.9),
                    0 0 24px 8px rgba(0,255,0,0.8),
                    0 0 36px 12px rgba(0,255,0,0.7),
                    0 0 48px 16px rgba(0,255,0,0.6)
                `;
                line.style.background = 'rgba(0,255,0,0.28)';
                line.style.border = '4px solid green';
            }

            overlay.appendChild(line);
        });

        topDoc.body.appendChild(overlay);
    }

    document.addEventListener('keydown', e => {
        if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

        const links = {
            KeyT: 'https://wisdom.wis.edu.hk/?timetable=true',
            KeyP: 'https://wisdom.wis.edu.hk/?timetable=true&pack=true'
        };

        const url = links[e.code];
        if (url) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            window.open(url, '_blank');
        }
    }, true);

    function extractWeekdayOrTomorrow(str) {
        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        const dayPattern = /\bDay([1-7])\b/i;
        const dayMatch = str.match(dayPattern);
        const dayNum = dayMatch ? parseInt(dayMatch[1], 10) : null;

        const weekdayRegex = new RegExp(`\\b(${weekdays.join('|')})\\b`, 'i');
        const weekdayMatch = str.match(weekdayRegex);

        if (weekdayMatch) {
            const matchedDay = weekdayMatch[0];
            const dow = weekdays.findIndex(day => day.toLowerCase() === matchedDay.toLowerCase());
            return [dayNum ?? '?', `on ${matchedDay} (Day ${dayNum ?? '?'})`, dow];
        }

        const today = new Date();
        const tomorrowIndex = (today.getDay() + 1) % 7;
        return [dayNum ?? '?', `tomorrow (Day ${dayNum ?? '?'})`, tomorrowIndex];
    }

    function extractDigits(str) {
        const digits = str.match(/\d+/g);
        if (!digits) return NaN;
        return Number(digits.join(''));
    }

    function waitForClassList(callback) {
        const targetSelector = 'ol a';

        const observer = new MutationObserver(() => {
            const links = document.querySelectorAll(targetSelector);
            if (links.length > 0) {
                observer.disconnect();
                callback(links);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    const onWISDOM = location.href.includes('wisdom.wis.edu.hk');
    const onClassroom = location.href.includes('classroom.google.com/h');
    const params = new URLSearchParams(window.location.search);
    const isTimetable = params.get('timetable') === 'true';
    const isPackMode = params.get('pack') === 'true';
    const yearGroup = 8;

    if (onClassroom) {
        window.addEventListener('load', () => {
            waitForClassList((links) => {
                const classDict = {};
                links.forEach(a => {
                    const name = a.textContent.trim().toLowerCase();
                    const url = a.href;
                    if (name && url) {
                        classDict[name] = url;
                    }
                });
                GM_setValue('classDict', classDict);
            });
        });
    }

    if (onWISDOM && isTimetable) {
        window.addEventListener('load', () => {
            setTimeout(() => {
                history.replaceState(null, '', `${location.origin}${location.pathname}`);

                const timetable = [...document.querySelectorAll("div > h5")].find(h5 => h5.textContent.trim() === "Timetable")?.parentElement;
                timetable.id = "timetable";

                const style = topDoc.createElement('style');
                style.textContent = `
                    #inst7857, #timetable {
                        box-shadow:
                            0 0 12px 4px rgba(0,255,0,0.9),
                            0 0 24px 8px rgba(0,255,0,0.8),
                            0 0 36px 12px rgba(0,255,0,0.7),
                            0 0 48px 16px rgba(0,255,0,0.6) !important;
                        background: rgba(0,255,0,0.28) !important;
                        border: 4px solid green !important;
                        border-bottom: 4px solid green !important;
                        border-radius: 10px !important;
                        transition: transform 0.3s ease, filter 0.3s ease !important;
                        cursor: pointer !important;
                    }

                    #inst7857:hover, #timetable:hover, .line:hover {
                        transform: scale(1.05) !important;
                        filter: brightness(1.2) !important;
                        transition: transform 0.3s ease, filter 0.3s ease !important;
                    }
                `;
                topDoc.head.appendChild(style);

                timetable.addEventListener('click', () => {
                    window.open(`https://wisdom.wis.edu.hk/?timetable=true${isPackMode ? '&pack=true' : ''}`, '_self');
                });

                document.querySelector('#inst7857').addEventListener('click', () => {
                    window.open(`https://wisdom.wis.edu.hk/?timetable=true${isPackMode ? '&pack=true' : ''}`, '_self');
                });

                timetable.scrollIntoView();

                const tables = timetable.querySelectorAll("table.welcomett") || [];

                if (isPackMode) {
                    let tomorrowTable;
                    let tomorrowSchoolDow;
                    let tomorrowDow;
                    let day;
                    tables.forEach((table) => {
                        const text = table.previousSibling?.previousSibling?.nodeValue?.trim();
                        if (text.includes('Tomorrow') || text.includes('Next')) {
                            tomorrowTable = table;
                            [tomorrowSchoolDow, day, tomorrowDow] = extractWeekdayOrTomorrow(text);
                        }
                    });

                    if (!tomorrowTable || !tomorrowSchoolDow || !day || !tomorrowDow) return buildOverlay(['<span class="emoji">❌</span> No timetable found for tomorrow']);
                    const rows = tomorrowTable.querySelectorAll('tr');
                    if (rows.length < 2) return buildOverlay(['<span class="emoji">❌</span> No timetable found for tomorrow']);
                    const lessonRow = rows[1];
                    const skippedTomorrow = getSkippedSetForDow(tomorrowDow);
                    const booksSet = new Set();
                    const books = GM_getValue('books', []);
                    let classCodes = [];
                    GM_setValue('books', books);
                    let PETomorrow = false;
                    for (const p of periodTimes) {
                        const cell = lessonRow.querySelector(`td.${p.class}`);
                        const { code, room } = parseCell(cell);
                        const displayName = getDisplayName(code, room);
                        const book = `${displayName} Book`;
                        classCodes.push(code);
                        booksSet.add(`<span${books.includes(code) ? '' : ` class="cross"`}>${skippedTomorrow.has(p.class) ? '<span style="text-decoration: line-through #FF0000 calc(1em / 3)">' : ''}${book ? `${p.label} - ${book}` : `${p.label} - ${displayName}`}${skippedTomorrow.has(p.class) ? '</span>' : ''}</span>`);
                        if (code.replace(/[^a-zA-Z]/g, '').toUpperCase() === 'PE') {
                            PETomorrow = true;
                        }
                    }
                    let lines = Array.from(booksSet);

                    if (tomorrowSchoolDow === yearGroup - 6) {
                        lines = ['<span class="emoji">🏫</span> Assembly Tomorrow <span class="emoji">🏫</span>', ...lines];
                        classCodes = [null, ...classCodes];
                    }

                    if (!lines.length) lines.push(`<span class="emoji">❌</span> No books needed ${day}`);

                    if (PETomorrow) lines.push(`<span class="emoji">✅</span> PE ${day}`);
                    else lines.push(`<span class="emoji">❌</span> No PE ${day}`);

                    const clickEvent = (i, line) => {
                        const iCode = classCodes[i];
                        if (!iCode) return;
                        const index = books.indexOf(iCode);
                        const span = line.querySelector('span');
                        if (index === -1) {
                            span.classList.remove('cross');
                            books.push(iCode);
                        } else {
                            span.classList.add('cross');
                            books.splice(index, 1);
                        }
                        GM_setValue('books', books);
                    };

                    buildOverlay(lines, undefined, clickEvent);
                    return;
                }

                let todayTable;
                let schoolDay;
                let assemblyToday = false;
                tables.forEach((table) => {
                    const text = table.previousSibling?.previousSibling?.nodeValue?.trim();
                    if (text.includes('Today')) {
                        todayTable = table;
                        schoolDay = extractDigits(text);
                    }
                });
                if (!todayTable || !schoolDay || isNaN(schoolDay)) return buildOverlay(['<span class="emoji">❌</span> No timetable found for today']);

                const rows = todayTable.querySelectorAll('tr');
                if (rows.length < 2) return buildOverlay(['<span class="emoji">❌</span> No timetable found for today']);

                const lessonRow = rows[1];
                const now = nowMins();
                const todayDow = new Date().getDay();
                const skippedToday = getSkippedSetForDow(todayDow);
                const skippedPeriod = getSkippedPeriodForDow(todayDow);
                const classDict = GM_getValue('classDict', {});
                let URLs = [];

                let lines = periodTimes.map(p => {
                    const cell = lessonRow.querySelector(`td.${p.class}`);
                    const { code, room } = parseCell(cell);
                    const displayName = getDisplayName(code, room);
                    let found = false;

                    const safeCode = code.toLowerCase().replace(/^0+/, '');
                    const safeRoom = room.toLowerCase();
                    const safeDisplayName = displayName.toLowerCase();

                    for (const [key, value] of Object.entries(classDict)) {
                        if (
                            (safeCode && key.includes(safeCode)) ||
                            (safeRoom && key.includes(safeRoom)) ||
                            (safeDisplayName && key.includes(safeDisplayName))
                        ) {
                            URLs.push(value);
                            found = true;
                            break;
                        }
                    }

                    if (found === false) URLs.push(null);
                    return `${skippedToday.has(p.class) ? '<span class="cross">' : ''}${found === true ? '<span class="emoji">🔗</span>' : ''}${p.label} - ${displayName}${room === '' ? '' : ` at ${room}`}${found === true ? '<span class="emoji">🔗</span>' : ''}${skippedToday.has(p.class) ? '</span>' : ''}`;
                });

                if (schoolDay === yearGroup - 6) {
                    assemblyToday = true;
                    lines = ['<span class="emoji">🏫</span> Assembly Today <span class="emoji">🏫</span>', ...lines];
                    URLs = [null, ...URLs];
                }

                const periodsToday = periodTimes.filter(p => !skippedToday.has(p.class));
                let highlightIndex = -1;
                for (const p of periodsToday) {
                    const i = p.i;
                    const start = mins(p.start);
                    const end = mins(p.end);
                    if ((now >= start && now <= end) || now < start) {
                        highlightIndex = assemblyToday === true ? i + 1 : i;
                        break;
                    }
                }

                if (highlightIndex >= skippedPeriod) highlightIndex += 1;

                const happyBirthday = ((list) => {
                    list = list.filter(birthday => birthday && birthday.trim());
                    if (list.length === 0) return null;
                    const joined = list.length === 1
                    ? list[0]
                    : list.length === 2
                    ? list.join(' and ')
                    : list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
                    return `<span class="emoji">🎉</span> Today: ${joined} <span class="emoji">🎉</span>`;
                })(
                    document.querySelector('#inst7857 .content small')
                    .innerHTML.split('<br>')
                    .filter(birthday => birthday.includes(String(yearGroup).padStart(2, '0')))
                    .map(birthday => {
                        const words = birthday.split(/\s+/);
                        const uppercaseIndex = words.findIndex(word => word === word.toUpperCase());
                        return uppercaseIndex >= 0 ? words.slice(0, uppercaseIndex).join(' ') : words;
                    })
                );

                const clickEvent = (i) => {
                    if (URLs[i]) location.href = URLs[i];
                };

                if (happyBirthday) lines.push(happyBirthday);

                if (lines.length === 0) {
                    buildOverlay(['<span class="emoji">❌</span> No more subjects for today']);
                } else {
                    buildOverlay(lines, highlightIndex, clickEvent);
                }

            }, 100);
        });
    }

    function onMinuteChange(callback) {
        if (window.__minuteIntervalId) clearInterval(window.__minuteIntervalId);

        const now = new Date();
        const msUntilNextMinute =
              (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

        setTimeout(() => {
            callback(new Date());

            window.__minuteIntervalId = setInterval(() => {
                callback(new Date());
            }, 60 * 1000);
        }, msUntilNextMinute);
    }

    function checkTime() {
        const now = nowMins();
        const todayDow = new Date().getDay();
        const skippedToday = getSkippedSetForDow(todayDow);

        for (let i = 0; i < periodTimes.length; i++) {
            const p = periodTimes[i];
            if (skippedToday.has(p.class)) continue;
            const start = mins(p.start);
            if ((start - 5) === now && document.visibilityState === 'visible' && new Date().getSeconds() === 0 && !(todayDow === 6 || todayDow === 0)) return buildOverlay(['Get to class now! 5 minutes left!']);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkTime);
    else checkTime();

    onMinuteChange(() => {
        checkTime();
    });
})();

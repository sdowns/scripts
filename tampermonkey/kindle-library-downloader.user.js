// ==UserScript==
// @name         Kindle Library Downloader
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Automate downloading books from Kindle library
// @author       You
// @match        https://www.amazon.com/hz/mycd/digital-console/contentlist/booksPurchases/*
// @grant        GM_download
// @grant        window.close
// @grant        GM.xmlHttpRequest
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @downloadstart
// ==/UserScript==

(function() {
    'use strict';

    // Add a button to start the download process
    const addDownloadButton = () => {
        const button = document.createElement('button');
        button.innerHTML = 'Download Library';
        button.style.position = 'fixed';
        button.style.top = '10px';
        button.style.right = '10px';
        button.style.zIndex = '9999';
        button.onclick = startDownloadProcess;
        document.body.appendChild(button);

        const resetButton = document.createElement('button');
        resetButton.innerHTML = 'Reset Progress';
        resetButton.style.position = 'fixed';
        resetButton.style.top = '40px';
        resetButton.style.right = '10px';
        resetButton.style.zIndex = '9999';
        resetButton.onclick = resetProgress;
        document.body.appendChild(resetButton);
    };

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const findElementByText = (text, tag = '*') => {
        const elements = document.getElementsByTagName(tag);
        for (const element of elements) {
            if (element.textContent.includes(text)) {
                return element;
            }
        }
        return null;
    };

    const waitForElement = async (selector, text = null, maxAttempts = 10) => {
        console.log(`Waiting for element: selector="${selector}", text="${text}"`);

        for (let i = 0; i < maxAttempts; i++) {
            let elements;

            try {
                // Handle jQuery-style :contains selector
                if (selector.includes(':contains')) {
                    const pureSelector = selector.replace(/:contains\(['"](.*?)['"]\)/, '');
                    const searchText = selector.match(/:contains\(['"](.*?)['"]\)/)[1];
                    elements = Array.from(document.querySelectorAll(pureSelector))
                        .filter(el => el.textContent.includes(searchText));
                } else {
                    elements = Array.from(document.querySelectorAll(selector));
                }

                // If looking for specific text
                if (text) {
                    elements = elements.filter(el => el.textContent.includes(text));
                }

                if (elements.length > 0) {
                    console.log(`Found ${elements.length} matching elements:`, elements);
                    return elements[0];
                }
            } catch (error) {
                console.error('Error in waitForElement:', error);
            }

            console.log(`Attempt ${i + 1}/${maxAttempts}: No matching elements found`);
            await wait(1000); // Increased wait time between attempts
        }

        console.log('Failed to find element after all attempts');
        return null;
    };

    // Add this helper function near the top with your other helpers
    const debugElement = (element, label = 'Element') => {
        if (!element) {
            console.log(`${label} not found`);
            return;
        }

        const computedStyle = window.getComputedStyle(element);
        const inlineStyle = element.getAttribute('style');

        console.log(`${label} Debug Info:`, {
            element: element,
            id: element.id,
            className: element.className,
            textContent: element.textContent,
            inlineStyle: inlineStyle,
            computedStyles: {
                opacity: computedStyle.opacity,
                display: computedStyle.display,
                visibility: computedStyle.visibility,
                background: computedStyle.background,
                backgroundImage: computedStyle.backgroundImage,
                cursor: computedStyle.cursor,
                pointerEvents: computedStyle.pointerEvents
            },
            boundingRect: element.getBoundingClientRect(),
            isVisible: element.offsetParent !== null,
            attributes: Array.from(element.attributes).map(attr => `${attr.name}="${attr.value}"`),
            parentElement: element.parentElement ? {
                tagName: element.parentElement.tagName,
                id: element.parentElement.id,
                className: element.parentElement.className
            } : null
        });
    };

    const waitForDynamicContent = async (timeout = 10000) => {
        return new Promise((resolve) => {
            let timer;
            const observer = new MutationObserver((mutations, obs) => {
                // Look for added nodes that might be our dialog
                for (const mutation of mutations) {
                    if (mutation.addedNodes.length) {
                        const addedDialog = Array.from(mutation.addedNodes).find(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                return node.classList.contains('a-modal-scroller') ||
                                       node.classList.contains('a-modal') ||
                                       (node.getAttribute('role') === 'dialog' && !node.id.startsWith('nav-flyout-'));
                            }
                            return false;
                        });
                        if (addedDialog) {
                            obs.disconnect();
                            clearTimeout(timer);
                            resolve(addedDialog);
                            return;
                        }
                    }
                }
            });

            // Start observing
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // Set timeout
            timer = setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    };

    // Add this new function to handle a single book download
    const downloadBook = async (bookContainer) => {
        try {
            // Get the book ID from the container
            const bookId = bookContainer.querySelector('[id^="content-title-"]')?.id?.split('-')[2];
            console.log('Processing book ID:', bookId);

            if (!bookId) {
                console.log('Could not find book ID');
                return false;
            }

            // Find and click More Actions button using the dropdown title div
            const moreActionsContainer = bookContainer.querySelector('[id="MORE_ACTION:false"]');
            if (!moreActionsContainer) {
                console.log('Could not find More Actions container');
                return false;
            }

            const dropdownTitle = moreActionsContainer.querySelector('#dd_title');
            if (!dropdownTitle) {
                console.log('Could not find dropdown title');
                return false;
            }

            console.log('Clicking More Actions dropdown...');
            dropdownTitle.click();
            await wait(500);

            // Get fresh reference to container after clicking More Actions
            const containerAfterMenu = document.querySelector(`.DigitalEntitySummary-module__container_3pUojes0Jk94VKwEcoGXyq [id^="content-title-${bookId}"]`)?.closest('.DigitalEntitySummary-module__container_3pUojes0Jk94VKwEcoGXyq');

            // Find download option within the refreshed container
            const downloadOption = Array.from(containerAfterMenu.querySelectorAll('span'))
                .find(span => span.textContent === 'Download & transfer via USB');
            if (!downloadOption) {
                console.log('Could not find Download option in container');
                return false;
            }

            const clickableElement = downloadOption.closest('a, button, div[role="menuitem"]') || downloadOption;
            clickableElement.click();
            await wait(500);

            // Wait for and find the dialog using the book ID
            const dialogId = `DOWNLOAD_AND_TRANSFER_DIALOG_${bookId}`;
            const dialog = document.getElementById(dialogId);
            if (!dialog) {
                console.log(`Could not find dialog with ID: ${dialogId}`);
                return false;
            }
            console.log('Found dialog:', dialog);

            // Look specifically for the radio button for this book within the dialog
            const radioButtonInDialog = dialog.querySelector(`#download_and_transfer_list_${bookId}_0`);
            if (!radioButtonInDialog) {
                console.log(`Could not find radio button for book ${bookId}`);
                return false;
            }

            console.log('Found radio button:', radioButtonInDialog);
            radioButtonInDialog.click();
            await wait(500);

            // Get fresh reference to dialog after clicking radio button
            const refreshedDialog = document.getElementById(dialogId);
            if (!refreshedDialog) {
                console.log(`Could not find refreshed dialog with ID: ${dialogId}`);
                return false;
            }

            // After clicking radio, look for the download button within the refreshed dialog
            // that has no opacity style set (meaning it's active)
            const buttons = refreshedDialog.querySelectorAll('div[tabindex="0"][id$="_CONFIRM"]');
            const downloadButton = Array.from(buttons).find(button => {
                // Check if the button has no inline opacity style
                return !button.style.opacity && button.querySelector('span')?.textContent === 'Download';
            });

            if (!downloadButton) {
                console.log('Could not find active download button');
                return false;
            }

            console.log('Found active download button:', downloadButton);
            downloadButton.click();
            await wait(500);

            return true;
        } catch (error) {
            console.error('Error in downloadBook:', error);
            return false;
        }
    };

    const waitForDownloadComplete = async () => {
        // Brief wait for download to start
        await wait(100);

        // Look for and click the notification close button
        const notificationClose = document.querySelector('#notification-close');
        if (notificationClose) {
            console.log('Closing notification...');
            notificationClose.click();
            await wait(25); // Brief wait for notification to close
        }

        // Look for any open dialogs
        const dialogs = document.querySelectorAll('[role="dialog"], .a-modal-scroller');
        if (dialogs.length > 0) {
            console.log('Waiting for dialogs to close...');
            await wait(25);
        }

        return true;
    };

    const closeAllMenus = async () => {
        // Click outside any open menus to close them
        document.body.click();
        await wait(100); // Reduced since menu closing is quick

        // Also try closing any open dialogs
        const closeButtons = document.querySelectorAll('button[aria-label="Close"]');
        for (const closeButton of closeButtons) {
            closeButton.click();
            await wait(100); // Reduced per button click
        }
    };

    // Modify startDownloadProcess to use the new wait function
    const startDownloadProcess = async () => {
        try {
            // Find all book containers instead of just action containers
            const bookContainers = Array.from(
                document.querySelectorAll('.DigitalEntitySummary-module__container_3pUojes0Jk94VKwEcoGXyq')
            );

            console.log(`Found ${bookContainers.length} books to process`);

            for (let i = 0; i < bookContainers.length; i++) {
                // Close any open menus before starting next book
                await closeAllMenus();
                await wait(100); // Reduced since menu closing is quick

                const bookTitle = `Book ${i + 1}`;
                console.log(`Processing book ${i + 1} of ${bookContainers.length}`);
                console.log(`Processing: ${bookTitle}`);

                const success = await downloadBook(bookContainers[i]);

                if (success) {
                    console.log(`Successfully processed book ${i + 1}: ${bookTitle}`);
                    await waitForDownloadComplete();
                } else {
                    console.log(`Failed to process book ${i + 1}: ${bookTitle}`);
                }

                // Brief wait between books
                await wait(100);
            }
        } catch (error) {
            console.error('Error in download process:', error);
        }
    };

    // Helper function to get element selectors
    const logElementInfo = () => {
        const inspectButton = document.createElement('button');
        inspectButton.innerHTML = 'Inspect Elements';
        inspectButton.style.position = 'fixed';
        inspectButton.style.top = '50px';
        inspectButton.style.right = '10px';
        inspectButton.style.zIndex = '9999';

        inspectButton.onclick = () => {
            const moreActionsButtons = Array.from(document.querySelectorAll('span')).filter(span =>
                span.textContent === 'More actions'
            );
            console.log('More Actions buttons found:', moreActionsButtons.length);

            if (moreActionsButtons.length > 0) {
                const firstButton = moreActionsButtons[0];
                console.log('First More Actions button:', firstButton);
                firstButton.click();

                setTimeout(() => {
                    const downloadOption = Array.from(document.querySelectorAll('span')).find(span =>
                        span.textContent === 'Download & transfer via USB'
                    );
                    console.log('Download option:', downloadOption);
                }, 1000);
            }
        };

        document.body.appendChild(inspectButton);
    };

    // Add a function to reset progress if needed
    const resetProgress = () => {
        GM_deleteValue('processedBooks');
        console.log('Progress reset - will reprocess all books');
    };

    // Start by adding both buttons
    addDownloadButton();
    logElementInfo();
})();
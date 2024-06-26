define(
    [
        'underscore',
        'backbone',
        'proactive/config',
        'text!proactive/templates/file-browser-template.html',
        'proactive/rest/studio-client',
        'proactive/view/BeautifiedModalAdapter'
    ],
    function (_, Backbone, config, fileBrowserTemplate, StudioClient, BeautifiedModalAdapter) {

    "use strict";

    return Backbone.View.extend({

        dataspace: "", // the concerned data space, its value could be "user" or "global".

        dataspaceRestUrl: config.prefixURL + "/rest/data/",

        uploadRequest: undefined,

        template: _.template(fileBrowserTemplate),

        filterValue:"*",

        model: {
            'files': [],
            'directories': [],
            'currentPath': "",
            'selectFolder': false, // identify the selected variable value should be a folder (true) or a regular file (false).
            'locationDescription': ""
        },

        events: {
            'click .file-browser-close': 'closeFileBrowser',
            'click .file-browser-file-tr,.file-browser-dir-tr': 'switchSelected',
            'dblclick .file-browser-dir-tr': 'enterFilesSubdir',
            'click .current-sub-path': 'enterDir',
            'click .file-browser-select-btn': 'selectFile',
            'click #upload-file-btn': 'chooseUploadFile',
            'change #selected-upload-file': 'uploadFile',
            'click #refresh-file-btn': 'refreshFiles',
            'click #new-folder-btn': 'createFolder',
            'click #download-file-btn': 'downloadFile',
            'click #delete-file-btn': 'deleteFile',
            'change #show-hidden-files' : 'showHiddenChange',
            'submit #filter-files': 'filterFiles'
        },

        initialize: function (options) {
            this.dataspace = options.dataspace;
            this.model['varKey'] = options.varKey;
            this.model['selectFolder'] = options.selectFolder;
            this.dataspaceRestUrl += options.dataspace + "/";
            this.model['locationDescription'] = options.dataspace.toUpperCase() + " DataSpace";
            this.showHidden = false;
            this.model['files'] = [];
            this.model['directories'] = [];
            this.model['showHidden'] = this.showHidden;
            switch (options.dataspace.toUpperCase()) {
                case "GLOBAL":
                    this.model['spaceDescription']="Global DataSpace is a shared storage on the server host where anyone can read/write files."
                    break;
                case "USER":
                    this.model['spaceDescription']="User DataSpace is a personal user data storage on the server host."
                    break;
                default:
                    this.model['spaceDescription']="";
            }

            this.$el = $('#file-browser-modal');
            var that = this;
            this.$el.on('hidden.bs.modal', function(event) {
                // stop inside modal trigger parent modal hidden event
                event.stopPropagation();
                // when the modal is closed, remove its events to avoid trigger duplicated events when reopen the modal
                that.undelegateEvents();
            });
            // whenever parent modal is hidden, close inside modal
            $('#execute-workflow-modal').on('hidden.bs.modal', function() {
                that.closeFileBrowser();
            });
        },

        filterFiles: function () {
            this.filterValue = document.getElementById("filter-files-input").value;
            if (this.filterValue === "") {
                this.filterValue = "*";
            }
            this.refreshFiles();
        },

        render: function () {
            this.model['currentPath'] = "";
            this.refreshFiles();
            this.$el.html(this.template(this.model));
            new BeautifiedModalAdapter().beautifyForm(this.$el);
            this.$el.modal('show');
            return this;
        },

        enterDir: function (event) {
            if( event.target.hasAttribute('value') ){
                this.model['currentPath'] = event.target.getAttribute('value');
                this.refreshFiles();
            }
        },

        showHiddenChange: function (event) {
            var checkbox = document.getElementById('show-hidden-files');
            if (checkbox.checked != this.showHidden) {
                this.showHidden = checkbox.checked;
                this.refreshFiles();
            }
        },

        enterFilesSubdir: function (event) {
            var clickedRow = $(event.target.parentElement)
            var clickedDir = clickedRow.children(".file-browser-dir");
            if( clickedDir ){
                this.model['currentPath'] = clickedDir.attr('value');
                this.refreshFiles();
            }
        },

        refreshFiles: function() {
            var that = this;
            var pathname = that.model['currentPath'];
            if(pathname.length == 0) {
                pathname = "%2E"; // root path "." need to be encoded as "%2E"
            }
            $.ajax({
                url: that.dataspaceRestUrl + encodeURIComponent(pathname),
                data: { "comp": "list-metadata", "includes": this.filterValue },
                headers: { "sessionid": localStorage['pa.session'] },
                success: function (data){
                    that.model['files'] = that.getFilesMetadata(data.fileListing, data);
                    that.model['directories'] = that.getFilesMetadata(data.directoryListing, data);
                    that.model['showHidden'] = that.showHidden;
                    that.$el.html(that.template(that.model));
                    if(that.uploadRequest) {
                        that.switchToUploadingState();
                    }
                    that.updateSearchBar();
                },
                error: function (xhr, status, error) {
                    var errorMessage = "";
                    if(xhr) {
                        errorMessage = ": " + (xhr.status == 401 || xhr.status == 403 ? xhr.statusText : xhr.errorMessage);
                    }
                    StudioClient.alert('Error', "Failed to access " + pathname + errorMessage, 'error');
                    that.updateSearchBar();
                }
            });

        },

        getFilesMetadata: function(fileNames, response) {
            var that = this;
            var filesMetadata = [];
            for (let i = 0; i < fileNames.length; i++) {
                filesMetadata[i] = {
                    name: fileNames[i],
                    type: response.types[fileNames[i]],
                    rights: response.permissions[fileNames[i]],
                    modified: that.toDateInClientFormat(response.lastModifiedDates[fileNames[i]])
                };
                if(filesMetadata[i].type != 'DIRECTORY') {
                    filesMetadata[i].size = that.toReadableFileSize(response.sizes[fileNames[i]]);
                }
            }
            return filesMetadata;
        },

        updateSearchBar: function() {
            document.getElementById("filter-files-input").value = this.filterValue;
            new BeautifiedModalAdapter().beautifyForm(this.$el);
        },

        toReadableFileSize: function(size) {
            if (typeof bytes !== 'number') {
                size = parseInt(size);
            }
            var units = [' B', ' KB', ' MB', ' GB', ' TB']
            let unitIndex = 0;
            while(size >= 1024 && unitIndex < units.length - 1) {
                size /= 1024 ;
                unitIndex++;
            }
            return size.toFixed(1) + units[unitIndex];
        },

        toDateInClientFormat: function(serverDate) {
            return new Date(serverDate).toLocaleString(undefined, { hour12: false });
        },

        switchSelected: function(event) {
            function SelectedElementIcon(){
                return $("#files-tbody  tr.selected i");
            }
            var targetRow = $(event.target.parentElement)
            if (targetRow.hasClass('selected')) {
                // deselect
                SelectedElementIcon().removeClass("fas");
                SelectedElementIcon().addClass("far");
                targetRow.removeClass("selected");
            } else {
                // mark the previous selected item as non-selected, as only one item could be selected at once.
                var selectedElement=$("#files-tbody  tr.selected");
                if (selectedElement && selectedElement.length != 0) {
                    SelectedElementIcon().removeClass("fas");
                    SelectedElementIcon().addClass("far");
                    selectedElement.removeClass("selected");
                }
                // highlight currently selected item
                targetRow.addClass("selected");
                SelectedElementIcon().removeClass("far");
                SelectedElementIcon().addClass("fas");
                $("#file-browser-error-message").text("");
            }
        },

        selectFile: function() {
            var selectedElement=$("#files-tbody  tr.selected");
            if (selectedElement.length == 0) {
                if (this.model['selectFolder']) {
                    $("#file-browser-error-message").text("Cannot find any folder selected: please select a folder !");
                } else {
                    $("#file-browser-error-message").text("Cannot find any file selected: please select a regular file !");
                }
                return;
            }

            var selectedFile;
            var selectErrorMessage = "";
            if (this.model['selectFolder']) {
                selectedFile = selectedElement.children(".file-browser-dir");
                selectErrorMessage = "The regular file is disallowed to be the variable value: please select a directory !";
            } else {
                selectedFile = selectedElement.children(".file-browser-file");
                selectErrorMessage = "The directory is disallowed to be the variable value: please select a regular file !";
            }
            if (selectedFile.length == 0) {
                $("#file-browser-error-message").text(selectErrorMessage);
            } else {
                // update the variable value to the selected file path
                var selectedFilePath = selectedFile.attr('value');
                // remove the trailing '/' in the path.
                if(selectedFilePath.endsWith('/')) {
                    selectedFilePath = selectedFilePath.slice(0, -1);
                }
                var studioApp = require('StudioApp');
                var updatedVar = {[this.model['varKey']]: selectedFilePath};
                if ($("#workflow-variables-modal").data('bs.modal') && $("#workflow-variables-modal").data('bs.modal').isShown) {
                    studioApp.views.workflowVariablesView.updateVariableValue(updatedVar);
                } else {
                    studioApp.views.jobVariableView.updateVariableValue(updatedVar);
                }
                this.closeFileBrowser();
            }
        },

        chooseUploadFile: function(event) {
            event.preventDefault();
            $('#selected-upload-file').click();
        },

        uploadFile: function(event) {
            var that = this;
            var selectedFile = event.target.files[0];
            if (selectedFile) {
                if (selectedFile.name.includes(':')) {
                    StudioClient.alert('Error', 'Uploading failed: the uploaded file name "' + selectedFile.name + '" should not contain colon.', 'error');
                    return;
                }
                var pathname = that.model['currentPath'] + selectedFile.name;
                that.switchToUploadingState();
                that.uploadRequest = $.ajax({
                    type: "PUT",
                    url: that.dataspaceRestUrl + encodeURIComponent(pathname),
                    data: selectedFile,
                    processData: false,
                    headers: { "sessionid": localStorage['pa.session'] },
                    success: function (data){
                        that.refreshFiles();
                        that.switchToNothingUploadingState();
                        that.uploadRequest = undefined;
                    },
                    error: function (xhr, status, error) {
                        var errorMessage = "";
                        if(xhr) {
                            errorMessage = ": "+ (xhr.status == 401 || xhr.status == 403 ? xhr.statusText : xhr.errorMessage);
                        }
                        StudioClient.alert('Error', "Failed to upload the file " + selectedFile.name + errorMessage, 'error');
                        that.switchToNothingUploadingState();
                        that.uploadRequest = undefined;
                    }
                });
            }
        },

        createFolder: function() {
            var that = this;
            $("#files-tbody").prepend('<tr><td> <i class="far fa-folder"> </i> <input class="new-folder" value="untitled-folder"/> </td></tr>');
            // workaround to focus the cursor at the end of the input
            var input = $(".new-folder");
            var value = input.val();
            input.focus().val("").blur().focus().val(value).select();

            // Create the new folder in server side
            $(".new-folder").keyup(function(event) {
                if ($(this).is(":focus") && event.key == "Enter") {
                    var pathname = that.model['currentPath'] + $(this).val();
                    if (pathname.includes(':')) {
                        StudioClient.alert('Create New Folder', 'Failed to create the new folder "' + pathname + '": it should not contain colon.', 'error');
                        return;
                    }
                    $.ajax({
                        type: "POST",
                        url: that.dataspaceRestUrl + encodeURIComponent(pathname),
                        data: {"mimetype": "application/folder"},
                        headers: { "sessionid": localStorage['pa.session'] },
                        success: function (data){
                            that.refreshFiles();
                        },
                        error: function (xhr, status, error) {
                            StudioClient.alert('Create New Folder', "Failed to create the new folder " + pathname + ": " + xhr.statusText , 'error');
                        }
                    });
                }
            });
        },

        downloadFile: function() {
            var selectedElement=$("#files-tbody  tr.selected").children().first();
            if (selectedElement.length == 0) {
                StudioClient.alert('Download', "No file chosen to be downloaded." , 'error');
                return;
            }
            var selectedFilePath = selectedElement.attr('value');
            var filename = selectedFilePath.match(/([^\/]*)\/*$/)[1];
            if (selectedElement.hasClass("file-browser-dir")) {
                var confirmMessage = 'You are about to download the folder "' + filename + '" as a zip archive "' + filename + '.zip", proceed ?'
                if (!confirm(confirmMessage)) {
                    return;
                }
                filename += ".zip";
            }

            // when the element to download is a folder, use zip encoding; if it's a file, use identity encoding to avoid decompress
            var encoding = selectedElement.hasClass("file-browser-dir") ? "zip" : "identity";
            var url = this.dataspaceRestUrl + encodeURIComponent(selectedFilePath) + "?encoding=" + encoding;

            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader("sessionid", localStorage['pa.session']);
            xhr.responseType = 'arraybuffer';
            xhr.onload = function (e) {
                if (xhr.status == 200) {
                    var blob = new Blob([this.response]);
                    var a = document.createElement('a');
                    a.href = window.URL.createObjectURL(blob);
                    a.download = filename;
                    a.click();
                } else {
                    StudioClient.alert('Download', "Failed to download the file " + selectedFilePath + ": "+ xhr.statusText, 'error');
                }
            };
            xhr.send();
        },

        deleteFile: function() {
            var selectedElement=$("#files-tbody  tr.selected").children().first();
            if (selectedElement.length == 0) {
                StudioClient.alert('Delete', "No file chosen to be deleted." , 'error');
                return;
            }
            var selectedFilePath = selectedElement.attr('value');
            var confirmMessage;
            if(selectedElement.hasClass("file-browser-dir")) {
                confirmMessage = `Are you sure you want to permanently delete the folder "${selectedFilePath}" and all the files in it ?`;
            } else {
                confirmMessage = `Are you sure you want to permanently delete the file "${selectedFilePath}" ?`;
            }
            if (confirm(confirmMessage)) {
                var that = this;
                $.ajax({
                    type: "DELETE",
                    url: that.dataspaceRestUrl + encodeURIComponent(selectedFilePath),
                    headers: { "sessionid": localStorage['pa.session'] },
                    success: function (data){
                        that.refreshFiles();
                    },
                    error: function (xhr, status, error) {
                        StudioClient.alert('Delete', "Failed to delete the file " + selectedFilePath + ": "+ xhr.statusText, 'error');
                    }
                });
            }
        },

        switchToUploadingState: function() {
            $("#upload-file-btn > i").removeClass('fa-upload').addClass('fa-spinner fa-pulse');
            $("#upload-file-btn").attr("disabled", true);
        },

        switchToNothingUploadingState: function() {
            $("#upload-file-btn > i").removeClass('fa-spinner fa-pulse').addClass('fa-upload');
            $("#upload-file-btn").attr("disabled", false);
        },

        closeFileBrowser: function () {
            this.$el.modal('hide');
            if(this.uploadRequest) {
                this.uploadRequest.abort();
            }
        }
    })
})

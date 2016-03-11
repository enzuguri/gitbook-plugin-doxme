var dox = require('dox');
var doxme = require('doxme');
var glob = require('glob');
var fs = require('fs');
var Path = require('path');
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');

function ensureDir(dir) {
    return new Promise(function(resolve, reject) {
        mkdirp(dir, function(err) {
            if (err) reject(err);
            resolve();
        });
    });
}

function clean(dir) {
    return new Promise(function(resolve, reject) {
        rimraf(dir, function(err) {
            if (err) reject(err);
            resolve();
        });
    })
    .then(function() {
        return ensureDir(dir);
    });
}

function createFileObject(data, path) {
    return {
        contents: data,
        path: path
    };
}

function getSourceFile(filename) {
    return new Promise(function(resolve, reject) {
        fs.readFile(filename, function(err, data) {
            if (err) reject(err);
            resolve(createFileObject(data, filename));
        });
    });
}

function getSourceFiles(path) {
    return new Promise(function(resolve, reject) {
        glob(path, function(err, files) {
            if (err) reject(err);
            resolve(files);
        });
    })
    .then(function(files) {
        return files.map(function(filename) {
            return getSourceFile(filename);
        });
    })
    .then(function(files) {
        return Promise.all(files);
    });
}

function parseFilesWithDox(logger, files) {
    return files.map(function(file) {
        var markdown = "";
        try {
            var obj = dox.parseComments(file.contents.toString());
            markdown = doxme(obj);
        } catch (ex) {
            logger.warn.ln('Unable to parse', file.path, ex.message);
            return undefined;
        }
        return createFileObject(new Buffer(markdown), file.path);
    })
    .filter(function(file) {
        return file !== undefined;
    });
}

function writeFileToDisk(contents, path) {
    return new Promise(function(resolve, reject) {
        fs.writeFile(path, contents, function(err) {
            if (err) reject(err);
            resolve(path);
        });
    });
}

function formatPath(dir, path) {
    var pathObj = Path.parse(path);
    pathObj.ext = ".md";
    pathObj.dir = dir;
    pathObj.base = pathObj.name + pathObj.ext;
    return Path.format(pathObj);
}

function writeFilesToDisk(dir, files) {
    var promises = files.map(function(file) {
        var path = formatPath(dir, file.path);
        return writeFileToDisk(file.contents, path);
    });
    return Promise.all(promises);
}

function addArticle(file, parentLevel, index) {
    var pathObj = Path.parse(file);
    var path = 'dox/' + pathObj.base; 
    return {
        path: path,
        level: [parentLevel, index+1].join('.'),
        title: pathObj.name,
        articles: [],
        exists: true,
        external: false,
        introduction: false
    }; 
}

function appendToSummary(summary, files) {
    var chapters = summary.chapters;
    var target = chapters[chapters.length-1];
    target.articles = files.map(function(file, index) {
        return addArticle(file, target.level, index);
    });
    return target.articles;
}

function appendToNavigation(navigation, articles) {
    var keys = Object.keys(navigation);
    
    var lastSegment = Object.keys(navigation).reduce(function(current, key) {
        var segment = navigation[key];
        segment.path = key;
        if(segment.index > current.index) {
            return segment;
        }
        return current;
    }, {index: 0});

    articles.reduce(function(previousNavigationSegment, article) {
        previousNavigationSegment.next = article;
        
        var path = article.path;
        
        var nextNavigationSegment = navigation[path] = {
            index: previousNavigationSegment.index + 1,
            level: article.level,
            title: article.title,
            introduction: false,
            path: path,
            prev: navigation[previousNavigationSegment.path],
            next: undefined 
        };

        return nextNavigationSegment;
    }, lastSegment);
}

exports.init = function() {
    var book = this;
    var logger = book.log;
    
    var opts = book.options.pluginsConfig.doxme;
    
    var rel = Path.relative(process.cwd(), book.root);

    var dir = Path.join(rel, 'dox');
    
    book.log.info.ln('cleaning output directory', dir);
    return clean(dir)
        .then(function() {
            logger.info.ok();
            logger.info.ln('Reading sources from', opts.src);
            return getSourceFiles(opts.src);
        })
        .then(function(files) {
            logger.info.ok();
            logger.info.ln('Parsing files...');
            return parseFilesWithDox(book.log, files);
        })
        .then(function(files) {
            logger.info.ok();
            logger.info.ln('Writing files to', dir);
            return writeFilesToDisk(dir, files);
        })
        .then(function(files) {
            logger.info.ok();
            return appendToSummary(book.summary, files);;
        })
        .then(function(articles) {
            appendToNavigation(book.navigation, articles);
        })
        .catch(function (err) {
            logger.error.ln(err.message);
        });
};

// Store specific to hierarchical mappings, will use silk-store internally

import _ from 'lodash';
import rxmq, {Rx} from 'ecc-messagebus';
import {
    isObjectMappingRule,
    MAPPING_RULE_TYPE_DIRECT,
    MAPPING_RULE_TYPE_OBJECT,
    MAPPING_RULE_TYPE_COMPLEX,
    MAPPING_RULE_TYPE_URI,
    MAPPING_RULE_TYPE_COMPLEX_URI,
    SUGGESTION_TYPES,
} from './helpers';
import {Suggestion} from './Suggestion';

const hierarchicalMappingChannel = rxmq.channel('silk.hierarchicalMapping');
const silkStore = rxmq.channel('silk.api');

// Set api details
let apiDetails = {
    transformTask: false,
    baseUrl: false,
    project: false,
};

// Set Api details
hierarchicalMappingChannel.subject('setSilkDetails').subscribe(data => {
    apiDetails = {...data};
});

const datatypes = _.map(
    [
        {
            value: 'AutoDetectValueType',
            label: 'Auto Detect',
            description:
                'The data type is decided automatically, based on the lexical form of each value.',
        },
        {
            value: 'UriValueType',
            label: 'URI',
            description:
                'Suited for values which are Unique Resource Identifiers',
        },
        {
            value: 'BooleanValueType',
            label: 'Boolean',
            description: 'Suited for values which are either true or false',
        },
        {
            value: 'StringValueType',
            label: 'String',
            description: 'Suited for values which contain text',
        },
        {
            value: 'IntegerValueType',
            label: 'Integer',
            description: 'Suited for numbers which have no fractional value',
        },
        {
            value: 'FloatValueType',
            label: 'Float',
            description: 'Suited for numbers which have a fractional value',
        },
        {
            value: 'LongValueType',
            label: 'Long',
            description:
                'Suited for large numbers which have no fractional value',
        },
        {
            value: 'DoubleValueType',
            label: 'Double',
            description:
                'Suited for large numbers which have a fractional value',
        },
        {
            value: 'DateValueType',
            label: 'Date',
            description:
                'Suited for XML Schema dates. Accepts values in the the following formats: xsd:date, xsd:gDay, xsd:gMonth, xsd:gMonthDay, xsd:gYear, xsd:gYearMonth.',
        },
        {
            value: 'DateTimeValueType',
            label: 'DateTime',
            description:
                'Suited for XML Schema dates and times. Accepts values in the the following formats: xsd:date, xsd:dateTime, xsd:gDay, xsd:gMonth, xsd:gMonthDay, xsd:gYear, xsd:gYearMonth, xsd:time.',
        },
    ],
    datatype => ({
        ...datatype,
        $search: _.deburr(
            `${datatype.value}|${datatype.label}|${datatype.description}`
        ).toLocaleLowerCase(),
    })
);

function filterPropertyType(input, replySubject) {
    const search = _.deburr(input).toLocaleLowerCase();

    replySubject.onNext({
        options: _.filter(datatypes, datatype =>
            _.includes(datatype.$search, search)
        ),
    });
    replySubject.onCompleted();
}

function findRule(curr, id, isObjectMapping, breadcrumbs) {
    const element = {
        ...curr,
        breadcrumbs,
    };

    if (element.id === id || _.get(element, 'rules.uriRule.id') === id) {
        return element;
    } else if (_.has(element, 'rules.propertyRules')) {
        let result = null;
        const bc = [
            ...breadcrumbs,
            {
                id: element.id,
                type: _.get(element, 'rules.typeRules[0].typeUri', false),
                property: _.get(element, 'mappingTarget.uri', false),
            },
        ];
        _.forEach(element.rules.propertyRules, child => {
            if (result === null) {
                result = findRule(child, id, isObjectMapping, bc);
            }
        });

        if (
            isObjectMapping &&
            result !== null &&
            !isObjectMappingRule(result.type)
        ) {
            result = element;
        }

        return result;
    }
    return null;
}

const handleCreatedSelectBoxValue = (data, path) => {
    if (_.has(data, [path, 'value'])) {
        return _.get(data, [path, 'value']);
    }
    // the select boxes return an empty array when the user delete the existing text,
    // instead of returning an empty string
    if (_.isEmpty(_.get(data, [path]))) {
        return '';
    }

    return _.get(data, [path]);
};

const prepareValueMappingPayload = data => {
    const payload = {
        metadata: {
            description: data.comment,
            label: data.label,
        },
        mappingTarget: {
            uri: handleCreatedSelectBoxValue(data, 'targetProperty'),
            valueType: {
                nodeType: handleCreatedSelectBoxValue(data, 'propertyType'),
            },
            isAttribute: data.isAttribute,
        },
    };

    if (data.type === MAPPING_RULE_TYPE_DIRECT) {
        payload.sourcePath = data.sourceProperty
            ? handleCreatedSelectBoxValue(data, 'sourceProperty')
            : '';
    }

    if (!data.id) {
        payload.type = data.type;
    }

    return payload;
};

const prepareObjectMappingPayload = data => {
    const typeRules = _.map(data.targetEntityType, typeRule => {
        const value = _.get(typeRule, 'value', typeRule);

        return {
            type: 'type',
            typeUri: value,
        };
    });

    const payload = {
        metadata: {
            description: data.comment,
            label: data.label,
        },
        mappingTarget: {
            uri: handleCreatedSelectBoxValue(data, 'targetProperty'),
            isBackwardProperty: data.entityConnection,
            valueType: {
                nodeType: 'UriValueType',
            },
        },
        sourcePath: data.sourceProperty
            ? handleCreatedSelectBoxValue(data, 'sourceProperty')
            : '',
        rules: {
            uriRule: data.pattern
                ? {
                      type: MAPPING_RULE_TYPE_URI,
                      pattern: data.pattern,
                  }
                : undefined,
            typeRules,
        },
    };

    if (!data.id) {
        payload.type = MAPPING_RULE_TYPE_OBJECT;
        payload.rules.propertyRules = [];
    }

    return payload;
};

const generateRule = (rule, parentId) =>
    hierarchicalMappingChannel
        .request({
            topic: 'rule.createGeneratedMapping',
            data: {...rule, parentId},
        })
        .catch(e => Rx.Observable.return({error: e, rule}));

const createGeneratedRules = ({rules, parentId}) =>
    Rx.Observable
        .from(rules)
        .flatMapWithMaxConcurrent(5, rule =>
            Rx.Observable.defer(() => generateRule(rule, parentId))
        )
        .reduce((all, result, idx) => {
            const total = _.size(rules);
            const count = idx + 1;

            hierarchicalMappingChannel
                .subject('rule.suggestions.progress')
                .onNext({
                    progressNumber: _.round(count / total * 100, 0),
                    lastUpdate: `Saved ${count} of ${total} rules.`,
                });

            all.push(result);

            return all;
        }, [])
        .map(createdRules => {

            const failedRules = _.filter(createdRules, 'error');

            if (_.size(failedRules)) {
                const error = new Error('Could not create rules.');
                error.failedRules = failedRules;
                throw error;
            }

            return createdRules;
        });

if (!__DEBUG__) {
    let rootId = null;

    const vocabularyCache = {};

    hierarchicalMappingChannel
        .subject('rule.orderRule')
        .subscribe(({data, replySubject}) => {
            const {childrenRules, id} = data;
            silkStore
                .request({
                    topic: 'transform.task.rule.rules.reorder',
                    data: {id, childrenRules, ...apiDetails},
                })
                .multicast(replySubject)
                .connect();
        });

    hierarchicalMappingChannel
        .subject('rules.generate')
        .subscribe(({data, replySubject}) => {
            const {correspondences, parentId} = data;
            silkStore
                .request({
                    topic: 'transform.task.rule.generate',
                    data: {...apiDetails, correspondences, parentId},
                })
                .map(returned => ({
                    rules: _.get(returned, ['body'], []),
                    parentId,
                }))
                .flatMap(createGeneratedRules)
                .multicast(replySubject)
                .connect();
        });

    hierarchicalMappingChannel
        .subject('vocabularyInfo.get')
        .subscribe(({data, replySubject}) => {
            const {uri, field} = data;

            const path = [uri, field];

            if (_.has(vocabularyCache, path)) {
                replySubject.onNext({
                    info: _.get(vocabularyCache, path),
                });
                replySubject.onCompleted();
            } else {
                silkStore
                    .request({
                        topic: 'transform.task.targetVocabulary.typeOrProperty',
                        data: {...apiDetails, uri},
                    })
                    .catch(() => Rx.Observable.just({}))
                    .map(returned => {
                        const info = _.get(
                            returned,
                            ['body', 'genericInfo', field],
                            null
                        );

                        _.set(vocabularyCache, path, info);

                        return {
                            info,
                        };
                    })
                    .multicast(replySubject)
                    .connect();
            }
        });

    hierarchicalMappingChannel
        .subject('rule.suggestions')
        .subscribe(({data, replySubject}) => {
            Rx.Observable
                .forkJoin(
                    silkStore
                        .request({
                            topic: 'transform.task.rule.suggestions',
                            data: {...apiDetails, ...data},
                        })
                        .catch(() => Rx.Observable.return(null))
                        .map(returned => {
                            const body = _.get(returned, 'body', []);

                            const suggestions = [];

                            _.forEach(body, (sources, target) => {
                                _.forEach(sources, ({uri, type, confidence}) => {
                                    suggestions.push(
                                        new Suggestion(uri, type, target, confidence)
                                    );
                                });
                            });
                            return suggestions;
                        }),
                    silkStore
                        .request({
                            topic: 'transform.task.rule.valueSourcePaths',
                            data: {unusedOnly: true, ...apiDetails, ...data},
                        })
                        .catch(() => Rx.Observable.return(null))
                        .map(returned => {
                            const body = _.get(returned, 'body', []);

                            return _.map(body, path => new Suggestion(path));
                        }),
                    (arg1, arg2) => ({
                        suggestions: _.concat([], arg1, arg2),
                    })
                )
                .multicast(replySubject)
                .connect();
        });

    function mapPeakResult(returned) {
        if (_.get(returned, 'body.status.id') !== 'success') {
            return {
                title: 'Could not load preview',
                detail: _.get(
                    returned,
                    'body.status.msg',
                    'No details available'
                ),
            };
        }

        return {
            example: returned.body,
        };
    }

    hierarchicalMappingChannel
        .subject('rule.child.example')
        .subscribe(({data, replySubject}) => {
            const {ruleType, rawRule, id} = data;
            const getRule = (rawRule, type) => {
                switch (type) {
                    case MAPPING_RULE_TYPE_DIRECT:
                    case MAPPING_RULE_TYPE_COMPLEX:
                        return prepareValueMappingPayload(rawRule);
                    case MAPPING_RULE_TYPE_OBJECT:
                        return prepareObjectMappingPayload(rawRule);
                    case MAPPING_RULE_TYPE_URI:
                    case MAPPING_RULE_TYPE_COMPLEX_URI:
                        return rawRule;
                    default:
                        throw new Error('Rule send to rule.child.example type must be in ("value","object","uri","complexURI")');
                }
            };
            const rule = getRule(rawRule, ruleType);
            if (rule && id) {
                silkStore
                    .request({
                        topic: 'transform.task.rule.child.peak',
                        data: {...apiDetails, id, rule},
                    })
                    .subscribe(returned => {
                        const result = mapPeakResult(returned);
                        if (result.title) {
                            replySubject.onError(result);
                        } else {
                            replySubject.onNext(result);
                        }
                        replySubject.onCompleted();
                    });
            }
        });

    hierarchicalMappingChannel
        .subject('rule.example')
        .subscribe(({data, replySubject}) => {
            const {id} = data;
            if (id) {
                silkStore
                    .request({
                        topic: 'transform.task.rule.peak',
                        data: {...apiDetails, id},
                    })
                    .subscribe(returned => {
                        const result = mapPeakResult(returned);
                        if (result.title) {
                            replySubject.onError(result);
                        } else {
                            replySubject.onNext(result);
                        }
                        replySubject.onCompleted();
                    });
            }
        });

    hierarchicalMappingChannel
        .subject('hierarchy.get')
        .subscribe(({replySubject}) => {
            silkStore
                .request({
                    topic: 'transform.task.rules.get',
                    data: {...apiDetails},
                })
                .map(returned => {
                    const rules = returned.body;

                    if (!_.isString(rootId)) {
                        rootId = rules.id;
                    }

                    return {
                        hierarchy: rules,
                    };
                })
                .multicast(replySubject)
                .connect();
        });

    hierarchicalMappingChannel
        .subject('rule.getEditorHref')
        .subscribe(({data, replySubject}) => {
            const {id: ruleId} = data;

            if (ruleId) {
                const {transformTask, baseUrl, project} = apiDetails;

                replySubject.onNext({
                    href: `${baseUrl}/transform/${project}/${transformTask}/editor/${ruleId}`,
                });
            } else {
                replySubject.onNext({
                    href: null,
                });
            }

            replySubject.onCompleted();
        });

    hierarchicalMappingChannel
        .subject('rule.get')
        .subscribe(({data, replySubject}) => {
            const {id, isObjectMapping} = data;

            silkStore
                .request({
                    topic: 'transform.task.rules.get',
                    data: {...apiDetails},
                })
                .map(returned => {
                    const rules = returned.body;

                    const searchId = id || rules.id;

                    if (!_.isString(rootId)) {
                        rootId = rules.id;
                    }

                    const rule = findRule(
                        _.cloneDeep(rules),
                        searchId,
                        isObjectMapping,
                        []
                    );

                    return {rule: rule || rules};
                })
                .multicast(replySubject)
                .connect();
        });

    hierarchicalMappingChannel
        .subject('autocomplete')
        .subscribe(({data, replySubject}) => {
            const {entity, input, ruleId = rootId} = data;

            let channel = 'transform.task.rule.completions.';

            switch (entity) {
                case 'propertyType':
                    filterPropertyType(input, replySubject);
                    return;
                case 'targetProperty':
                    channel += 'targetProperties';
                    break;
                case 'targetEntityType':
                    channel += 'targetTypes';
                    break;
                case 'sourcePath':
                    channel += 'sourcePaths';
                    break;
                default:
                    if (__DEBUG__) {
                        console.error(`No autocomplete defined for ${entity}`);
                    }
            }

            silkStore
                .request({
                    topic: channel,
                    data: {...apiDetails, term: input, ruleId},
                })
                .map(returned => ({options: returned.body}))
                .multicast(replySubject)
                .connect();
        });

    const editMappingRule = (payload, id, parent) => {
        if (id) {
            return silkStore.request({
                topic: 'transform.task.rule.put',
                data: {
                    ...apiDetails,
                    ruleId: id,
                    payload,
                },
            });
        }

        return silkStore.request({
            topic: 'transform.task.rule.rules.append',
            data: {
                ...apiDetails,
                ruleId: parent,
                payload,
            },
        });
    };

    hierarchicalMappingChannel
        .subject('rule.createValueMapping')
        .subscribe(({data, replySubject}) => {
            const payload = prepareValueMappingPayload(data);
            const parent = data.parentId ? data.parentId : rootId;

            editMappingRule(payload, data.id, parent)
                .multicast(replySubject)
                .connect();
        });

    hierarchicalMappingChannel
        .subject('rule.createObjectMapping')
        .subscribe(({data, replySubject}) => {
            const payload = prepareObjectMappingPayload(data);
            const parent = data.parentId ? data.parentId : rootId;

            editMappingRule(payload, data.id, parent)
                .multicast(replySubject)
                .connect();
        });

    hierarchicalMappingChannel
        .subject('rule.updateObjectMapping')
        .subscribe(({data, replySubject}) => {
            editMappingRule(data, data.id, parent)
                .multicast(replySubject)
                .connect();
        });

    hierarchicalMappingChannel
        .subject('rule.createGeneratedMapping')
        .subscribe(({data, replySubject}) => {
            const payload = data;
            const parent = data.parentId ? data.parentId : rootId;

            editMappingRule(payload, false, parent)
                .multicast(replySubject)
                .connect();
        });

    hierarchicalMappingChannel
        .subject('rule.removeRule')
        .subscribe(({data, replySubject}) => {
            const {id} = data;
            silkStore
                .request({
                    topic: 'transform.task.rule.delete',
                    data: {
                        ...apiDetails,
                        ruleId: id,
                    },
                })
                .subscribe(
                    () => {
                        replySubject.onNext();
                        replySubject.onCompleted();
                        hierarchicalMappingChannel
                            .subject('reload')
                            .onNext(true);
                    },
                    err => {
                        // TODO: Beautify
                    }
                );
        });
} else {
    // eslint-disable-next-line
    const rawMockStore = require("./retrieval2.json");

    let mockStore = null;

    try {
        mockStore = JSON.parse(localStorage.getItem('mockStore'));
    } catch (e) {
        console.warn('Could not load mockStore', e);
    }

    if (mockStore === null) {
        mockStore = _.cloneDeep(rawMockStore);
    }

    hierarchicalMappingChannel
        .subject('rules.generate')
        .subscribe(({data, replySubject}) => {
            const {correspondences, parentId} = data;

            const rules = [];

            _.map(correspondences, correspondence => {
                if (correspondence.type === SUGGESTION_TYPES[0]) {
                    rules.push({
                        metadata: {
                            description: _.includes(
                                correspondence.sourcePath,
                                'error'
                            )
                                ? 'error'
                                : '',
                        },
                        mappingTarget: {
                            uri: correspondence.targetProperty,
                            valueType: {
                                nodeType: 'AutoDetectValueType',
                            },
                        },
                        sourcePath: correspondence.sourcePath,
                        type: MAPPING_RULE_TYPE_DIRECT,
                    });
                }
                else if (correspondence.type === SUGGESTION_TYPES[1]) {
                    rules.push({
                        metadata: {
                            description: _.includes(
                                correspondence.sourcePath,
                                'error'
                            )
                                ? 'error'
                                : '',
                        },
                        type : MAPPING_RULE_TYPE_OBJECT,
                        sourcePath : correspondence.sourcePath,
                        mappingTarget : {
                            uri: correspondence.targetProperty,
                            valueType : {
                                nodeType : "AutoDetectValueType"
                            },
                            isBackwardProperty: false
                        },
                    });
                }
                else {
                    alert('holy crap!')
                }
            });

            Rx.Observable
                .return({rules, parentId})
                .flatMap(createGeneratedRules)
                .multicast(replySubject)
                .connect();
        });

    hierarchicalMappingChannel
        .subject('rule.suggestions')
        .subscribe(({data, replySubject}) => {
            const suggRaw = {
                'https://spec.edmcouncil.org/fibo/ontology/FND/AgentsAndPeople/People/hasDateOfBirth': [
                    {
                        uri: '/birthdate',
                        confidence: 0.028520143597925807,
                        type: 'object',
                    },
                ],
                'http://xmlns.com/foaf/0.1/surname': [
                    {
                        uri: '/surname',
                        confidence: 0.21,
                        type: 'object'
                    },
                    {
                        uri: '/name',
                        confidence: 0.0170975813177648,
                        type: 'object'
                    },
                ],
                'http://xmlns.com/foaf/0.1/birthday': [
                    {
                        uri: '/birthdate',
                        confidence: 0.043659343420819535,
                        type: 'object'
                    },
                ],
                'http://xmlns.com/foaf/0.1/lastName': [
                    {
                        uri: '/surname',
                        confidence: 0.001,
                        type: 'value'
                    },
                    {
                        uri: '/name',
                        confidence: 0.00458715596330274,
                        type: 'value'
                    },
                ],
                'http://schema.org/birthDate': [
                    {
                        uri: '/birthdate',
                        confidence: 0.07339449541284403,
                        type: 'value'
                    },
                ],
            };

            const directRaw = [
                '/birthdate',
                '/address',
                '/surname',
                '/name',
                '/fatal-error',
                '/error',
            ];

            const suggestions = [];

            for (let i = 0; i < 10; i++) {
                _.forEach(suggRaw, (sources, target) => {
                    _.forEach(sources, ({uri, type, confidence}) => {
                        suggestions.push(new Suggestion(
                            uri + (i < 1 ? '': i),
                            type,
                            target,
                            confidence
                        ));
                    });
                });
            }

            _.forEach(directRaw, source => {
                suggestions.push(new Suggestion(
                    source,
                    "value",
                    null,
                    0,
                ));
            });
            replySubject.onNext({
                suggestions,
            });
            replySubject.onCompleted();
        });

    hierarchicalMappingChannel
        .subject('autocomplete')
        .subscribe(({data, replySubject}) => {
            const {entity, input} = data;

            let result = [];

            switch (entity) {
                case 'propertyType':
                    filterPropertyType(input, replySubject);
                    return;
                case 'targetProperty':
                    result = [
                        {
                            value: 'http://xmlns.com/foaf/0.1/knows',
                            label: 'foaf:knows',
                            description:
                                'A person known by this person (indicating some level of reciprocated interaction between the parties).',
                        },
                        {
                            value: 'http://xmlns.com/foaf/0.1/name',
                            label: 'foaf:name',
                            description: 'A name for some thing.',
                        },
                        {
                            value: 'http://schmea.org/address',
                            label: 'schema:address',
                            description: 'Physical address of the item.',
                        },
                    ];
                    break;
                case 'targetEntityType':
                    result = [
                        {
                            value: 'http://xmlns.com/foaf/0.1/Person',
                            label: 'foaf:Person',
                            description:
                                "The Person class represents people. Something is a Person if it is a person. We don't nitpic about whether they're alive, dead, real, or imaginary. The Person class is a sub-class of the Agent class, since all people are considered 'agents' in FOAF.",
                        },
                        {
                            value: 'http://schema.org/PostalAddress',
                            label: 'schema:PostalAddress',
                            description: 'The mailing address.',
                        },
                    ];
                    break;
                case 'sourcePath':
                    result = [
                        {value: '/name', label: 'name'},
                        {value: '/address', label: 'address'},
                        {value: '/last_name', label: 'last name'},
                    ];
                    break;
                default:
                    if (__DEBUG__) {
                        console.error(`No autocomplete defined for ${entity}`);
                    }
            }

            const search = _.isString(input) ? input.toLocaleLowerCase() : '';

            replySubject.onNext({
                options: _.filter(
                    result,
                    ({value, label, description}) =>
                        _.includes(value.toLocaleLowerCase(), search) ||
                        _.includes(label.toLocaleLowerCase(), search) ||
                        _.includes(description.toLocaleLowerCase(), search)
                ),
            });

            replySubject.onCompleted();
        });

    hierarchicalMappingChannel
        .subject('hierarchy.get')
        .subscribe(({replySubject}) => {
            const hierarchy = _.chain(mockStore).value();

            replySubject.onNext({hierarchy});
            replySubject.onCompleted();
        });

    hierarchicalMappingChannel
        .subject('rule.child.example')
        .subscribe(({replySubject}) => {
            const example = {
                sourcePaths: [
                    [
                        '/name',
                        '/otherProperty',
                        '/evenLongerProperty',
                        '/another:urn:Very+long+property+from+a+column-header'
                    ],
                    ['/whatever:urn:This+is+a+very+very+very+very+very+very+very+very+very+very+long+column+title+just+to+have+a+header+to+describe+the+birthdate']
                ],
                results: [
                    {
                        sourceValues: [['Abigale Purdy'], ['7/21/1977']],
                        transformedValues: ['abigale purdy7/21/1977'],
                    },
                    {
                        sourceValues: [['Ronny Wiegand'], ['10/24/1963']],
                        transformedValues: ['ronny wiegand10/24/1963'],
                    },
                    {
                        sourceValues: [['Rosalyn Wisozk'], ['5/8/1982']],
                        transformedValues: ['rosalyn wisozk5/8/1982'],
                    },
                ],
                status: {id: 'success', msg: ''},
            };
            replySubject.onNext({example});
            replySubject.onCompleted();
        });

    hierarchicalMappingChannel
        .subject('rule.example')
        .subscribe(({replySubject}) => {
            const example = {
                sourcePaths: [
                    [
                        '/name'
                    ],
                    [
                        '/whatever:urn:This+is+a+very+very+very+very+very+very+very+very+very+very+long+column+title+just+to+have+a+header+to+describe+the+birthdate'
                    ]
                ],
                results: [
                    {
                        sourceValues: [
                            [
                                'Abigale Purdy',
                                '2',
                                'fibo-whatever-1',
                                'fibo-another-stuff',
                                'Abigale Purdy',
                                '2',
                                'fibo-whatever-1',
                                'fibo-another-stuff',
                                'Abigale Purdy',
                                '2',
                                'fibo-whatever-1',
                                'fibo-another-stuff',
                                'Abigale Purdy',
                                '2',
                                'fibo-whatever-1',
                                'fibo-another-stuff',
                                'Abigale Purdy',
                                '2',
                                'fibo-whatever-1',
                                'fibo-another-stuff',
                                'Abigale Purdy',
                                '2',
                                'fibo-whatever-1',
                                'fibo-another-stuff',
                            ],
                            ['7/21/1977']
                        ],
                        transformedValues: ['abigale purdy7/21/1977'],
                    },
                    {
                        sourceValues: [['Ronny Wiegand'], ['10/24/1963']],
                        transformedValues: ['ronny wiegand10/24/1963'],
                    },
                    {
                        sourceValues: [['Rosalyn Wisozk'], ['5/8/1982']],
                        transformedValues: ['rosalyn wisozk5/8/1982'],
                    },
                ],
                status: {id: 'success', msg: ''},
            };
            replySubject.onNext({example});
            replySubject.onCompleted();
        });

    hierarchicalMappingChannel
        .subject('rule.get')
        .subscribe(({data, replySubject}) => {
            const {id, isObjectMapping = false} = data;
            const rule = findRule(
                _.cloneDeep(mockStore),
                id,
                isObjectMapping,
                []
            );
            const result = _.isNull(rule) ? mockStore : rule;
            replySubject.onNext({rule: result});
            replySubject.onCompleted();
        });

    const appendToMockStore = (store, id, payload) => {
        if (store.id === id && _.has(store, 'rules.propertyRules')) {
            store.rules.propertyRules.push(payload);
        } else if (store.id === id) {
            store.rules.propertyRules = [payload];
        } else if (_.has(store, 'rules.propertyRules')) {
            _.forEach(_.get(store, 'rules.propertyRules'), childRule => {
                appendToMockStore(childRule, id, payload);
            });
        }
    };

    const editRule = (store, id, payload) => {
        if (store.id === id) {
            if (
                _.has(store.rules, 'typeRules') &&
                _.has(payload.rules, 'typeRules')
            ) {
                store.rules.typeRules = payload.rules.typeRules;
            }
            _.merge(store, payload);
        } else if (_.has(store, 'rules.propertyRules')) {
            _.forEach(_.get(store, 'rules.propertyRules'), childRule => {
                editRule(childRule, id, payload);
            });
        }
    };

    const saveMockStore = reload => {
        if (reload) {
            hierarchicalMappingChannel.subject('reload').onNext(true);
        }
        localStorage.setItem('mockStore', JSON.stringify(mockStore));
    };

    const handleUpdatePreparedRule = ({data, replySubject}) => {
        const payload = data;

        if (_.includes(data.metadata.description, 'error')) {
            const err = new Error('Could not save rule.');
            _.set(err, 'response.body', {
                title: 'I am just a regular error',
                detail:
                    'I am one error, but a tiny one that normal users never see',
                cause: [
                    {
                        title: 'I am just a regular error',
                        detail:
                            'I am one error, but a tiny one that normal users never see',
                        cause: [],
                    },
                ],
            });

            replySubject.onError(err);
            replySubject.onCompleted();
            return;
        }

        payload.id = `${Date.now()}${_.random(0, 100, false)}`;

        const parent = data.parentId ? data.parentId : mockStore.id;
        appendToMockStore(mockStore, parent, payload);

        saveMockStore();

        replySubject.onNext(data);
        replySubject.onCompleted();
    };

    const handleUpdate = ({data, replySubject}) => {
        const payload = isObjectMappingRule(data.type)
            ? prepareObjectMappingPayload(data)
            : prepareValueMappingPayload(data);

        if (_.includes(data.comment, 'error')) {
            const err = new Error('Could not save rule.');
            _.set(err, 'response.body', {
                title: 'I am just a regular error',
                detail:
                    'Comment can not contain error, that is not an error but it is an error',
                cause: [
                    {
                        title: 'I am just a forced error',
                        detail:
                            'I am THE error, a big one that everyone would see',
                        cause: [],
                    },
                ],
            });
            replySubject.onError(err);
            replySubject.onCompleted();
            return;
        }

        if (data.id) {
            editRule(mockStore, data.id, payload);
            saveMockStore();
        } else {
            payload.id = `${Date.now()}${_.random(0, 100, false)}`;

            const parent = data.parentId ? data.parentId : mockStore.id;
            appendToMockStore(mockStore, parent, payload);

            saveMockStore();
        }

        replySubject.onNext();
        replySubject.onCompleted();
    };

    hierarchicalMappingChannel
        .subject('rule.createValueMapping')
        .subscribe(handleUpdate);

    hierarchicalMappingChannel
        .subject('rule.createObjectMapping')
        .subscribe(handleUpdate);

    hierarchicalMappingChannel
        .subject('rule.createGeneratedMapping')
        .subscribe(handleUpdatePreparedRule);

    const removeRule = (store, id) => {
        if (store.id === id) {
            return null;
        } else if (_.has(store, 'rules.propertyRules')) {
            store.rules.propertyRules = _.filter(
                store.rules.propertyRules,
                v => removeRule(v, id) !== null
            );
        }
        return store;
    };

    hierarchicalMappingChannel
        .subject('rule.removeRule')
        .subscribe(({data, replySubject}) => {
            const {id} = data;
            mockStore = removeRule(_.chain(mockStore).value(), id);
            saveMockStore();
            replySubject.onNext();
            replySubject.onCompleted();
        });

    const orderRule = (store, id, childrenRules) => {
        if (_.has(store, 'rules.propertyRules')) {
            if (id === store.id) {
                store.rules.propertyRules = _.map(childrenRules, ruleId =>
                    _.find(store.rules.propertyRules, rule =>
                        rule.id === ruleId)
                )
            }
            else {
                store.rules.propertyRules = store.rules.propertyRules.map(
                    rule => orderRule(rule, id, fromPos, toPos)
                )
            }

        }
        return store;
    };

    hierarchicalMappingChannel
        .subject('rule.orderRule')
        .subscribe(({data, replySubject}) => {
            const {id, childrenRules, reload} = data;
            mockStore = orderRule(_.chain(mockStore).value(), id, childrenRules);
            saveMockStore(reload);
            replySubject.onNext();
            replySubject.onCompleted();
        });

    // eslint-disable-next-line
    const loremIpsum = require("lorem-ipsum");

    hierarchicalMappingChannel
        .subject('vocabularyInfo.get')
        .subscribe(({data, replySubject}) => {
            const {field} = data;

            const ret = {info: null};

            switch (field) {
                case 'label':
                    break;
                case 'description':
                    ret.info = loremIpsum({
                        count: _.random(0, 2),
                        units: 'paragraphs',
                    });
                    break;
                default:
                    if (__DEBUG__) {
                        console.warn(
                            `No info for field ${field} available in mockStore`
                        );
                    }
            }

            replySubject.onNext(ret);
            replySubject.onCompleted();
        });
}

export default hierarchicalMappingChannel;
